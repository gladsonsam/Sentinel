//! Shared application state, threaded through Axum via `Arc<AppState>`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc, oneshot};
use uuid::Uuid;

/// Capacity for each agent’s command queue (viewer → server → agent). Bounded to bound memory.
pub const AGENT_CMD_CHANNEL_CAPACITY: usize = 512;

/// Bounded sender for JSON command lines to the agent WebSocket task.
pub type AgentCmdSender = mpsc::Sender<String>;

/// Online agent entry (keyed by agent id in [`AppState::agents`]).
#[derive(Debug, Clone)]
pub struct AgentConn {
    pub connected_at: DateTime<Utc>,
}

/// Latest foreground / URL / activity as reported by the agent over WebSocket (for integration API).
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct AgentLiveSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// A message fanned-out to every active dashboard viewer.
#[derive(Clone, Debug)]
pub enum Broadcast {
    /// Serialised JSON event (keystroke, window change, URL, etc.).
    Text(String),
}

/// Global application state (DB pool, live agents, sessions, telemetry broadcast).
pub struct AppState {
    pub db: PgPool,
    pub tx: broadcast::Sender<Broadcast>,
    pub agents: Mutex<HashMap<Uuid, AgentConn>>,
    pub frames: Mutex<HashMap<Uuid, Frame>>,

    /// Per-agent command fan-in (viewer → server → agent WebSocket).
    pub agent_cmds: Mutex<HashMap<Uuid, AgentCmdSender>>,

    /// MJPEG viewer refcount per agent; drives `start_capture` / `stop_capture`.
    pub capture_viewers: Mutex<HashMap<Uuid, u32>>,

    pub allow_insecure_dashboard_open: bool,
    pub agent_secret: Option<String>,
    pub allow_insecure_agent_auth: bool,
    wol_last_wake: Mutex<HashMap<Uuid, Instant>>,
    pub wol_min_interval: Duration,
    pub allow_remote_script: bool,
    pub script_waiters: Mutex<HashMap<Uuid, oneshot::Sender<serde_json::Value>>>,
    pub(crate) login_failures: Mutex<HashMap<String, Vec<Instant>>>,
    /// Per (rule_id, agent_id) last fire time for alert cooldowns.
    pub alert_match_cooldowns: Mutex<HashMap<(i64, Uuid), Instant>>,

    /// Optional Prometheus metrics (when `METRICS_ENABLED`).
    pub metrics: Option<Arc<crate::metrics::AppMetrics>>,

    /// Idempotency for `POST .../software/collect`: (agent_id, key) → last use time.
    pub software_collect_dedup: Mutex<HashMap<(Uuid, String), Instant>>,

    /// External notification providers (Home Assistant, future: Slack, ntfy, …).
    pub notify_hub: crate::notify::NotifyHub,

    /// Last-known live telemetry per connected agent (window, URL, AFK). Cleared on disconnect.
    pub agent_live: Mutex<HashMap<Uuid, AgentLiveSnapshot>>,

    /// When set, `GET /api/integration/agents/live` accepts `Authorization: Bearer <token>`.
    pub integration_api_token: Option<String>,

    /// Public base URL for deep links in external notifications (e.g. Home Assistant).
    /// Example: `https://sentinel.example.com`
    pub public_base_url: Option<String>,
}

/// Cached JPEG with a monotonic `seq` for MJPEG change detection.
#[derive(Clone, Debug)]
pub struct Frame {
    pub seq: u64,
    pub jpeg: Bytes,
}

impl AppState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: PgPool,
        allow_insecure_dashboard_open: bool,
        agent_secret: Option<String>,
        allow_insecure_agent_auth: bool,
        wol_min_interval: Duration,
        allow_remote_script: bool,
        metrics: Option<Arc<crate::metrics::AppMetrics>>,
        notify_hub: crate::notify::NotifyHub,
        integration_api_token: Option<String>,
        public_base_url: Option<String>,
    ) -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            db,
            tx,
            agents: Mutex::new(HashMap::new()),
            frames: Mutex::new(HashMap::new()),
            agent_cmds: Mutex::new(HashMap::new()),
            capture_viewers: Mutex::new(HashMap::new()),
            allow_insecure_dashboard_open,
            agent_secret,
            allow_insecure_agent_auth,
            wol_last_wake: Mutex::new(HashMap::new()),
            wol_min_interval,
            allow_remote_script,
            script_waiters: Mutex::new(HashMap::new()),
            login_failures: Mutex::new(HashMap::new()),
            alert_match_cooldowns: Mutex::new(HashMap::new()),
            metrics,
            software_collect_dedup: Mutex::new(HashMap::new()),
            notify_hub,
            agent_live: Mutex::new(HashMap::new()),
            integration_api_token,
            public_base_url,
        }
    }

    /// Merge WebSocket telemetry into the live snapshot for integration consumers (Home Assistant, etc.).
    pub fn update_agent_live_from_event(
        &self,
        agent_id: Uuid,
        kind: &str,
        val: &serde_json::Value,
    ) {
        let mut map = self.agent_live.lock();
        let snap = map.entry(agent_id).or_default();
        let now = Utc::now();
        match kind {
            "window_focus" => {
                if let Some(t) = val["title"].as_str() {
                    snap.window_title = Some(t.to_string());
                }
                if let Some(a) = val["app"].as_str() {
                    snap.window_app = Some(a.to_string());
                }
                snap.updated_at = Some(now);
            }
            "url" => {
                if let Some(u) = val["url"].as_str() {
                    snap.url = Some(u.to_string());
                }
                snap.updated_at = Some(now);
            }
            "afk" => {
                let idle = val["idle_secs"]
                    .as_i64()
                    .or_else(|| val["idle_secs"].as_u64().map(|u| u as i64))
                    .unwrap_or(0);
                snap.activity = Some("afk".into());
                snap.idle_secs = Some(idle.max(0));
                snap.updated_at = Some(now);
            }
            "active" => {
                snap.activity = Some("active".into());
                snap.idle_secs = Some(0);
                snap.updated_at = Some(now);
            }
            _ => {}
        }
    }

    pub fn clear_agent_live(&self, agent_id: Uuid) {
        self.agent_live.lock().remove(&agent_id);
    }

    /// Returns `Err(retry_after_secs)` when WoL for this agent is throttled.
    pub fn wol_throttle_check(&self, agent_id: Uuid) -> Result<(), u64> {
        if self.wol_min_interval.is_zero() {
            return Ok(());
        }
        let map = self.wol_last_wake.lock();
        let now = Instant::now();
        if let Some(last) = map.get(&agent_id) {
            let elapsed = now.saturating_duration_since(*last);
            if elapsed < self.wol_min_interval {
                let wait = (self.wol_min_interval - elapsed).as_secs().max(1);
                return Err(wait);
            }
        }
        Ok(())
    }

    pub fn wol_mark_sent(&self, agent_id: Uuid) {
        if self.wol_min_interval.is_zero() {
            return;
        }
        self.wol_last_wake.lock().insert(agent_id, Instant::now());
    }

    pub fn register_script_waiter(&self, id: Uuid, sender: oneshot::Sender<serde_json::Value>) {
        self.script_waiters.lock().insert(id, sender);
    }

    pub fn remove_script_waiter(&self, id: Uuid) {
        self.script_waiters.lock().remove(&id);
    }

    /// Deliver an agent `script_result` to a waiting HTTP request, if any.
    pub fn try_complete_script_waiter(&self, id: Uuid, payload: serde_json::Value) -> bool {
        if let Some(tx) = self.script_waiters.lock().remove(&id) {
            let _ = tx.send(payload);
            return true;
        }
        false
    }

    /// Forward a control payload to a connected agent (same wire format as viewer controls).
    pub fn try_send_agent_command_json(&self, agent_id: Uuid, cmd: &serde_json::Value) -> bool {
        let Ok(s) = serde_json::to_string(cmd) else {
            return false;
        };
        self.agent_cmds
            .lock()
            .get(&agent_id)
            .map(|tx| tx.try_send(s).is_ok())
            .unwrap_or(false)
    }

    /// Send a JSON string to every connected viewer (fire-and-forget).
    pub fn broadcast(&self, msg: impl Into<String>) {
        let _ = self.tx.send(Broadcast::Text(msg.into()));
    }
}
