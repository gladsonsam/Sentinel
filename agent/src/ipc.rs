use base64::Engine;
use serde::{Deserialize, Serialize};

#[cfg(windows)]
pub const AGENT_IPC_PIPE_NAME: &str = r"\\.\pipe\SentinelAgentIpc";

/// Frames forwarded between the user-session companion and the Session 0 service.
#[derive(Debug, Clone)]
pub enum OutboundFrame {
    Text(String),
    Binary(Vec<u8>),
}

/// One JSON object per line, newline-terminated (named-pipe friendly).
///
/// We keep this intentionally simple:
/// - Most telemetry is already JSON text the server understands → `WsText`.
/// - Screen frames are forwarded as base64 in `WsBinaryB64`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcLine {
    /// Forward this string as a WebSocket `Text` frame to the server.
    WsText { text: String },
    /// Forward this base64 payload as a WebSocket `Binary` frame to the server.
    WsBinaryB64 { data_b64: String },
    /// Best-effort hint from the companion: config on disk was updated.
    ConfigChanged,
}

impl IpcLine {
    pub fn to_line(&self) -> String {
        let mut s = serde_json::to_string(self).unwrap_or_else(|_| "{\"type\":\"invalid\"}".into());
        s.push('\n');
        s
    }

    pub fn from_slice(bytes: &[u8]) -> Option<IpcLine> {
        serde_json::from_slice(bytes).ok()
    }

    pub fn into_outbound(self) -> Option<OutboundFrame> {
        match self {
            IpcLine::WsText { text } => Some(OutboundFrame::Text(text)),
            IpcLine::WsBinaryB64 { data_b64 } => {
                let decoded = base64::engine::general_purpose::STANDARD.decode(data_b64).ok()?;
                Some(OutboundFrame::Binary(decoded))
            }
            IpcLine::ConfigChanged => None,
        }
    }
}

pub fn outbound_binary_line(bytes: &[u8]) -> String {
    let data_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    IpcLine::WsBinaryB64 { data_b64 }.to_line()
}

