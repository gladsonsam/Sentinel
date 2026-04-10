#![cfg(target_os = "windows")]

use std::time::Duration;

use anyhow::Result;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tracing::warn;

const UPDATER_PUBKEY_B64: &str =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDkwNkVDQzFDMjkzRjVEN0QKUldSOVhUOHBITXh1a003RnZYUUhqNmdsRkZTMktrbnFnZGRMZUFnaGYwNmxqV0tyL2h3bTlCUkYK";

const PIPE_NAME: &str = r"\\.\pipe\SentinelAgentUpdater";

fn decode_signature(sig: &str) -> Result<Signature> {
    let s = sig.trim();
    if s.contains('\n') || s.contains("untrusted comment") {
        return Signature::decode(s).map_err(|e| anyhow::anyhow!("{e:?}"));
    }
    // Some updater JSON formats embed the minisign signature as base64.
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| anyhow::anyhow!("signature was not valid base64 and not minisign text"))?;
    let text = String::from_utf8(bytes).map_err(|_| anyhow::anyhow!("decoded signature was not valid UTF-8"))?;
    Signature::decode(text.trim()).map_err(|e| anyhow::anyhow!("{e:?}"))
}

pub fn verify_msi_signature(msi_bytes: &[u8], signature: &str) -> Result<()> {
    let pk = PublicKey::from_base64(UPDATER_PUBKEY_B64).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let sig = decode_signature(signature)?;
    pk.verify(msi_bytes, &sig, false)
        .map_err(|e| anyhow::anyhow!("signature verify failed: {e:?}"))?;
    Ok(())
}

async fn connect_pipe() -> Result<NamedPipeClient> {
    // The service may not be ready yet right after boot; retry a few times.
    let mut last_err: Option<anyhow::Error> = None;
    for _ in 0..30 {
        match ClientOptions::new().open(PIPE_NAME) {
            Ok(c) => return Ok(c),
            Err(e) => {
                last_err = Some(anyhow::anyhow!("{e}"));
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("failed to connect updater pipe")))
}

async fn pipe_call_update_now() -> Result<()> {
    let mut client = connect_pipe().await?;
    let req = serde_json::json!({
        "action": "update_now",
    })
    .to_string();
    client.write_all(req.as_bytes()).await?;
    client.shutdown().await?;

    // Best-effort read response (service may close immediately after scheduling).
    let mut buf = Vec::new();
    let _ = client.read_to_end(&mut buf).await;
    if !buf.is_empty() {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) {
            if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
                return Ok(());
            }
            if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
                anyhow::bail!("updater service error: {e}");
            }
        }
    }
    Ok(())
}

/// Ask the elevated Windows service to check for updates and install silently.
///
/// Designed to be called from the normal user-mode agent process (no UAC).
pub async fn update_via_service() -> Result<()> {
    pipe_call_update_now().await
}

/// Helper used by the agent when it knows it's going to be replaced.
pub fn exit_for_update() -> ! {
    warn!("Exiting agent for update install.");
    std::process::exit(0);
}

