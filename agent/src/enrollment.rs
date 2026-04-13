//! One-time adoption: dashboard 6-digit enrollment code → per-device WebSocket token.
//!
//! - **MDM / file:** `%ProgramData%\Sentinel\enroll.json` is consumed on startup.
//! - **UI:** Tauri command `adopt_with_enrollment_code` calls the same HTTP exchange.

#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use serde::Deserialize;
#[cfg(target_os = "windows")]
use tracing::{info, warn};

use crate::config::Config;

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct EnrollJson {
    enrollment_token: String,
    server_url: String,
    #[serde(default)]
    agent_name: Option<String>,
}

#[cfg(target_os = "windows")]
fn enroll_json_path() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join("Sentinel")
        .join("enroll.json")
}

/// `wss://host/p...` → `https://host/api/agent/enroll` (path on WSS host is ignored for enroll).
#[cfg(target_os = "windows")]
pub(crate) fn wss_to_enroll_post_url(wss: &str) -> Option<String> {
    let rest = wss.trim().strip_prefix("wss://")?;
    let authority = rest.split('/').next().unwrap_or(rest);
    if authority.is_empty() {
        return None;
    }
    Some(format!("https://{authority}/api/agent/enroll"))
}

/// Exchange enrollment code for a per-device token; write machine-wide `config.dat`; return effective config.
#[cfg(target_os = "windows")]
pub async fn adopt_with_enrollment(
    wss_url: &str,
    enrollment_token: &str,
    agent_name: &str,
) -> anyhow::Result<Config> {
    let enroll_url = wss_to_enroll_post_url(wss_url)
        .ok_or_else(|| anyhow::anyhow!("Server URL must start with wss://"))?;

    let token = enrollment_token.trim();
    if token.is_empty() {
        anyhow::bail!("Enrollment code is empty");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()?;

    let resp = client
        .post(&enroll_url)
        .json(&serde_json::json!({
            "enrollment_token": token,
            "agent_name": agent_name.trim(),
        }))
        .send()
        .await?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::CONFLICT {
        let suffix = if status == reqwest::StatusCode::CONFLICT {
            " If this PC was already enrolled with the same agent name, either keep the existing config.dat (token), pick a new agent name, or reset that agent’s credentials in the dashboard (Admin → Settings → Agent enrollment codes → Reset an agent)."
        } else {
            ""
        };
        anyhow::bail!(
            "Enrollment rejected HTTP {}: {body_text}{suffix}",
            status.as_u16()
        );
    }
    if !status.is_success() {
        anyhow::bail!("Enrollment failed ({status}): {body_text}");
    }

    let val: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| anyhow::anyhow!("Invalid JSON from server: {e}; body={body_text:?}"))?;

    let agent_token = val
        .get("agent_token")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Server response missing agent_token"))?;

    let mut cfg = crate::config::load_config();
    cfg.server_url = wss_url.trim().to_string();
    cfg.agent_name = agent_name.trim().to_string();
    cfg.agent_password = agent_token.to_string();

    crate::config::write_machine_policy_dat(&cfg)?;
    info!("Enrollment succeeded; machine-wide config.dat updated.");
    Ok(cfg)
}

#[cfg(not(target_os = "windows"))]
pub async fn adopt_with_enrollment(
    _wss_url: &str,
    _enrollment_token: &str,
    _agent_name: &str,
) -> anyhow::Result<Config> {
    anyhow::bail!("Enrollment is only supported on Windows")
}

/// If `enroll.json` exists, redeem it and write machine `config.dat`. Returns `Ok(true)` when
/// configuration on disk changed.
#[cfg(target_os = "windows")]
pub async fn try_consume_pending_enrollment() -> anyhow::Result<bool> {
    let path = enroll_json_path();
    if !path.is_file() {
        return Ok(false);
    }

    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!("Could not read {}: {e}", path.display());
            return Ok(false);
        }
    };

    let file: EnrollJson = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!("Invalid enroll.json ({}): {e}", path.display());
            let _ = std::fs::remove_file(&path);
            return Ok(false);
        }
    };

    let agent_name = file
        .agent_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::env::var("COMPUTERNAME").unwrap_or_else(|_| "agent".to_string())
        });

    match adopt_with_enrollment(&file.server_url, &file.enrollment_token, &agent_name).await {
        Ok(_) => {
            let _ = std::fs::remove_file(&path);
            info!("Removed enroll.json after successful enrollment.");
            Ok(true)
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("rejected HTTP 401")
                || msg.contains("rejected HTTP 409")
                || msg.contains("Invalid enroll.json")
            {
                warn!("{msg}; removing enroll.json");
                let _ = std::fs::remove_file(&path);
                return Ok(false);
            }
            warn!("Enrollment failed (will retry after restart): {e:#}");
            Ok(false)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub async fn try_consume_pending_enrollment() -> anyhow::Result<bool> {
    Ok(false)
}
