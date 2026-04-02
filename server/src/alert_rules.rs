//! URL / keystroke alert rules: load effective rules for an agent and broadcast matches to viewers.
//!
//! Rules are defined in Postgres with **scopes** (`all`, `group`, `agent`) so the same rule
//! definition can target every machine, a group, or one agent; multiple scopes per rule are allowed.

use std::sync::Arc;
use std::time::Instant;

use regex::RegexBuilder;
use uuid::Uuid;

use crate::db::{self, AlertRuleRow};
use crate::state::AppState;

fn haystack_for_channel(channel: &str, payload: &serde_json::Value) -> String {
    match channel {
        "url" => payload["url"].as_str().unwrap_or("").to_string(),
        "keys" => payload["text"].as_str().unwrap_or("").to_string(),
        _ => String::new(),
    }
}

fn truncate_snippet(s: &str, channel: &str) -> String {
    let max_chars = if channel == "keys" { 48 } else { 120 };
    let t: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        format!("{t}…")
    } else {
        t
    }
}

fn rule_matches(rule: &AlertRuleRow, haystack: &str) -> bool {
    if haystack.is_empty() {
        return false;
    }
    match rule.match_mode.as_str() {
        "regex" => {
            let Ok(re) = RegexBuilder::new(&rule.pattern)
                .case_insensitive(rule.case_insensitive)
                .build()
            else {
                return false;
            };
            re.is_match(haystack)
        }
        _ => {
            if rule.case_insensitive {
                let h = haystack.to_lowercase();
                let p = rule.pattern.to_lowercase();
                h.contains(&p)
            } else {
                haystack.contains(&rule.pattern)
            }
        }
    }
}

/// After telemetry is persisted, evaluate alert rules and notify dashboard viewers.
pub async fn on_url_or_keys_event(
    state: &Arc<AppState>,
    agent_id: Uuid,
    agent_name: &str,
    channel: &str,
    payload: &serde_json::Value,
) {
    if channel != "url" && channel != "keys" {
        return;
    }

    let haystack = haystack_for_channel(channel, payload);
    if haystack.is_empty() {
        return;
    }

    let rules = match db::alert_rules_effective_for_agent(&state.db, agent_id, channel).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "alert_rules_effective_for_agent failed");
            return;
        }
    };

    for rule in rules {
        if !rule_matches(&rule, &haystack) {
            continue;
        }

        let cooldown = rule.cooldown_secs.max(0) as u64;
        if cooldown > 0 {
            let mut map = state.alert_match_cooldowns.lock().unwrap();
            let key = (rule.id, agent_id);
            let now = Instant::now();
            if let Some(last) = map.get(&key) {
                if now.duration_since(*last).as_secs() < cooldown {
                    continue;
                }
            }
            map.insert(key, now);
        }

        let snippet = truncate_snippet(&haystack, channel);
        state.broadcast(
            serde_json::json!({
                "event": "alert_rule_match",
                "rule_id": rule.id,
                "rule_name": rule.name,
                "channel": channel,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "snippet": snippet,
                "ts": chrono::Utc::now().timestamp(),
            })
            .to_string(),
        );
    }
}
