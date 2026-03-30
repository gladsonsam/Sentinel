//! Shared application state, threaded through Axum via `Arc<AppState>`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc::UnboundedSender, oneshot};
use uuid::Uuid;

// ─── Agent info ───────────────────────────────────────────────────────────────

/// Metadata for a currently-connected agent.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AgentConn {
    pub id: Uuid,
    pub name: String,
    pub connected_at: DateTime<Utc>,
}

// ─── Broadcast message ────────────────────────────────────────────────────────

/// A message fanned-out to every active dashboard viewer.
#[derive(Clone, Debug)]
pub enum Broadcast {
    /// Serialised JSON event (keystroke, window change, URL, etc.).
    Text(String),
}

// ─── App state ────────────────────────────────────────────────────────────────

pub struct AppState {
    /// Postgres connection pool.
    pub db: PgPool,

    /// Fan-out channel: every telemetry event is cloned to all viewers.
    pub tx: broadcast::Sender<Broadcast>,

    /// Currently-connected agents (keyed by DB UUID).
    pub agents: Mutex<HashMap<Uuid, AgentConn>>,

    /// Most-recent JPEG frame per agent – served by both the HTTP snapshot
    /// endpoint and the MJPEG stream.
    pub frames: Mutex<HashMap<Uuid, Frame>>,

    /// Per-agent command channels.
    ///
    /// Viewers send control JSON (MouseMove / MouseClick) to the server which
    /// looks up the target agent here and forwards the command string.  The
    /// agent's WebSocket handler drains its `Receiver` inside a `select!`.
    pub agent_cmds: Mutex<HashMap<Uuid, UnboundedSender<String>>>,

    /// Number of MJPEG viewers currently watching each agent.
    ///
    /// The MJPEG endpoint increments this on connect and decrements it when
    /// the HTTP connection closes (via a RAII [`CaptureGuard`]).
    /// - Count  0 → 1: send `{"type":"start_capture"}` to agent.
    /// - Count  1 → 0: send `{"type":"stop_capture"}` to agent.
    pub capture_viewers: Mutex<HashMap<Uuid, u32>>,

    /// Plain-text UI password loaded from `UI_PASSWORD` env var.
    /// `None` means the dashboard is open with no authentication.
    pub ui_password: Option<String>,

    /// When `ui_password` is unset, allow dashboard access without auth.
    /// This exists only for local/dev setups; default should be `false`.
    pub allow_insecure_dashboard_open: bool,

    /// Shared secret for authenticating agents connecting to `/ws/agent`.
    /// `None` means agents can connect without authentication (NOT recommended for prod).
    pub agent_secret: Option<String>,

    /// When `agent_secret` is unset, allow agents to connect without auth.
    /// This exists only for local/dev setups; default should be `false`.
    pub allow_insecure_agent_auth: bool,

    /// Active dashboard session tokens (random UUIDs issued on login).
    /// Stored in memory only — reset when the server restarts.
    pub sessions: Mutex<HashSet<String>>,

    /// Last successful Wake-on-LAN per agent (in-memory throttle).
    wol_last_wake: Mutex<HashMap<Uuid, Instant>>,
    /// Minimum time between WoL magic packets for the same agent (`0` = no limit).
    pub wol_min_interval: Duration,

    /// When false, `POST .../script` and bulk script are rejected (remote code execution).
    pub allow_remote_script: bool,

    /// Label stored in `audit_log.actor` for dashboard actions until per-user login exists.
    /// Set via `DASHBOARD_OPERATOR_NAME` (default `operator`).
    pub audit_operator_name: String,

    /// HTTP handlers wait on these until the agent posts `script_result` (or timeout).
    pub script_waiters: Mutex<HashMap<Uuid, oneshot::Sender<serde_json::Value>>>,
}

/// A cached screenshot frame with a monotonically increasing sequence number.
///
/// The MJPEG stream uses `seq` to reliably detect "new frame" without having to
/// compare bytes (frame sizes can repeat even when the image changes).
#[derive(Clone, Debug)]
pub struct Frame {
    pub seq: u64,
    pub jpeg: Bytes,
}

impl AppState {
    pub fn new(
        db: PgPool,
        ui_password: Option<String>,
        allow_insecure_dashboard_open: bool,
        agent_secret: Option<String>,
        allow_insecure_agent_auth: bool,
        wol_min_interval: Duration,
        allow_remote_script: bool,
        audit_operator_name: String,
    ) -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            db,
            tx,
            agents: Mutex::new(HashMap::new()),
            frames: Mutex::new(HashMap::new()),
            agent_cmds: Mutex::new(HashMap::new()),
            capture_viewers: Mutex::new(HashMap::new()),
            ui_password,
            allow_insecure_dashboard_open,
            agent_secret,
            allow_insecure_agent_auth,
            sessions: Mutex::new(HashSet::new()),
            wol_last_wake: Mutex::new(HashMap::new()),
            wol_min_interval,
            allow_remote_script,
            audit_operator_name,
            script_waiters: Mutex::new(HashMap::new()),
        }
    }

    /// Returns `Err(retry_after_secs)` when WoL for this agent is throttled.
    pub fn wol_throttle_check(&self, agent_id: Uuid) -> Result<(), u64> {
        if self.wol_min_interval.is_zero() {
            return Ok(());
        }
        let map = self.wol_last_wake.lock().unwrap();
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
        self.wol_last_wake
            .lock()
            .unwrap()
            .insert(agent_id, Instant::now());
    }

    pub fn register_script_waiter(&self, id: Uuid, sender: oneshot::Sender<serde_json::Value>) {
        self.script_waiters.lock().unwrap().insert(id, sender);
    }

    pub fn remove_script_waiter(&self, id: Uuid) {
        self.script_waiters.lock().unwrap().remove(&id);
    }

    /// Deliver an agent `script_result` to a waiting HTTP request, if any.
    pub fn try_complete_script_waiter(&self, id: Uuid, payload: serde_json::Value) -> bool {
        if let Some(tx) = self.script_waiters.lock().unwrap().remove(&id) {
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
            .unwrap()
            .get(&agent_id)
            .map(|tx| tx.send(s).is_ok())
            .unwrap_or(false)
    }

    /// Send a JSON string to every connected viewer (fire-and-forget).
    pub fn broadcast(&self, msg: impl Into<String>) {
        let _ = self.tx.send(Broadcast::Text(msg.into()));
    }
}
