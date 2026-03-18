//! Persistent configuration and shared runtime state for the agent.

use base64::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

// ─── Configuration ────────────────────────────────────────────────────────────

/// Agent connection + security configuration, persisted to disk as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Full WebSocket URL of the Sentinel server.
    /// Example: `ws://192.168.1.100:9000/ws/agent`
    #[serde(default)]
    pub server_url: String,

    /// Friendly name sent to the server as `?name=<agent_name>`.
    /// Defaults to the Windows `COMPUTERNAME` environment variable.
    #[serde(default = "default_agent_name")]
    pub agent_name: String,

    /// Password / token forwarded to the server as `secret=...` for agent auth.
    #[serde(default)]
    pub agent_password: String,

    /// SHA-256 hex-digest of the local UI access password.
    /// An empty-string hash (`hash_password("")`) means no password required.
    #[serde(default = "empty_password_hash")]
    pub ui_password_hash: String,

    /// Whether to ignore TLS certificate errors (for self-signed / local certs).
    #[serde(default)]
    pub insecure_tls: bool,
}

fn default_agent_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "agent".into())
}

fn empty_password_hash() -> String {
    hash_password("")
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            agent_name: default_agent_name(),
            agent_password: String::new(),
            ui_password_hash: empty_password_hash(),
            insecure_tls: false,
        }
    }
}

/// Returns the SHA-256 hex-digest of `password`.
pub fn hash_password(password: &str) -> String {
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    format!("{:x}", h.finalize())
}

/// Path to the obfuscated config file.
///
/// On Windows: `%LOCALAPPDATA%\sentinel\config.dat`
pub fn config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sentinel")
        .join("config.dat")
}

/// Load configuration from disk; falls back to `Config::default()` on any error.
pub fn load_config() -> Config {
    let path = config_path();
    let old_path = path.with_extension("json");

    let mut cfg = Config::default();

    // 1. Try reading the new base64 dat file
    if let Ok(b64) = std::fs::read_to_string(&path) {
        if let Ok(dec) = BASE64_STANDARD.decode(b64.trim()) {
            if let Ok(s) = String::from_utf8(dec) {
                if let Ok(c) = serde_json::from_str::<Config>(&s) {
                    cfg = c;
                }
            }
        }
    } 
    // 2. Fall back to old config.json
    else if let Ok(json) = std::fs::read_to_string(&old_path) {
        if let Ok(c) = serde_json::from_str::<Config>(&json) {
            cfg = c;
        }
    }

    // Optional environment overrides, useful when running headless (no UI).
    // These only override when the env var is present and non-empty.
    if let Ok(v) = std::env::var("AGENT_SERVER_URL") {
        let v = v.trim();
        if !v.is_empty() {
            cfg.server_url = v.to_string();
        }
    }
    if let Ok(v) = std::env::var("AGENT_NAME") {
        let v = v.trim();
        if !v.is_empty() {
            cfg.agent_name = v.to_string();
        }
    }
    if let Ok(v) = std::env::var("AGENT_PASSWORD") {
        let v = v.trim();
        if !v.is_empty() {
            cfg.agent_password = v.to_string();
        }
    }
    if let Ok(v) = std::env::var("AGENT_INSECURE_TLS") {
        let v = v.trim();
        if !v.is_empty() {
            cfg.insecure_tls = matches!(v, "1" | "true" | "TRUE");
        }
    }

    cfg
}

/// Persist configuration to disk, creating parent directories as needed.
pub fn save_config(config: &Config) -> anyhow::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    let json = serde_json::to_string(config)?;
    let b64 = BASE64_STANDARD.encode(json.as_bytes());
    std::fs::write(&path, b64)?;

    // Attempt to clean up the old readable json file safely
    let old_path = path.with_extension("json");
    let _ = std::fs::remove_file(old_path);
    
    Ok(())
}

// ─── Agent status ─────────────────────────────────────────────────────────────

/// Real-time connection status of the agent, shared between the background
/// tokio thread (writer) and the GUI thread (reader).
#[derive(Clone, Debug, Default, PartialEq)]
pub enum AgentStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    /// A human-readable description of the last error.
    Error(String),
}
