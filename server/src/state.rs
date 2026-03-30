//! Shared application state, threaded through Axum via `Arc<AppState>`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc::UnboundedSender, oneshot};
use uuid::Uuid;

/// Online agent entry (keyed by agent id in [`AppState::agents`]).
#[derive(Debug, Clone)]
pub struct AgentConn {
    pub connected_at: DateTime<Utc>,
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
    pub agent_cmds: Mutex<HashMap<Uuid, UnboundedSender<String>>>,

    /// MJPEG viewer refcount per agent; drives `start_capture` / `stop_capture`.
    pub capture_viewers: Mutex<HashMap<Uuid, u32>>,

    pub ui_password: Option<String>,
    pub allow_insecure_dashboard_open: bool,
    pub agent_secret: Option<String>,
    pub allow_insecure_agent_auth: bool,
    pub sessions: Mutex<HashSet<String>>,
    wol_last_wake: Mutex<HashMap<Uuid, Instant>>,
    pub wol_min_interval: Duration,
    pub allow_remote_script: bool,
    pub audit_operator_name: String,
    pub script_waiters: Mutex<HashMap<Uuid, oneshot::Sender<serde_json::Value>>>,
    pub(crate) login_failures: Mutex<HashMap<String, Vec<Instant>>>,
}

/// Cached JPEG with a monotonic `seq` for MJPEG change detection.
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
            login_failures: Mutex::new(HashMap::new()),
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
