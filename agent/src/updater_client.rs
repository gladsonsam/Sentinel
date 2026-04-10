#![cfg(target_os = "windows")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tracing::{info, warn};

const UPDATER_ENDPOINT: &str = "https://github.com/gladsonsam/Sentinel/releases/latest/download/latest.json";
const UPDATER_PUBKEY_B64: &str =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDkwNkVDQzFDMjkzRjVEN0QKUldSOVhUOHBITXh1a003RnZYUUhqNmdsRkZTMktrbnFnZGRMZUFnaGYwNmxqV0tyL2h3bTlCUkYK";

const PIPE_NAME: &str = r"\\.\pipe\SentinelAgentUpdater";

#[derive(Debug)]
struct LatestInfo {
    version: String,
    url: String,
    signature: String,
}

fn program_data_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("Sentinel")
}

fn updates_dir() -> PathBuf {
    program_data_dir().join("updates")
}

fn decode_signature(sig: &str) -> Result<Signature> {
    let s = sig.trim();
    if s.contains('\n') || s.contains("untrusted comment") {
        return Signature::decode(s).map_err(|e| anyhow::anyhow!("{e:?}"));
    }
    // Some updater JSON formats embed the minisign signature as base64.
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s)
        .context("signature was not valid base64 and not minisign text")?;
    let text = String::from_utf8(bytes).context("decoded signature was not valid UTF-8")?;
    Signature::decode(text.trim()).map_err(|e| anyhow::anyhow!("{e:?}"))
}

fn pick_windows_platform(obj: &serde_json::Value) -> Option<(&serde_json::Value, String)> {
    let platforms = obj.get("platforms")?.as_object()?;
    // Prefer known keys but tolerate naming changes.
    let preferred = ["windows-x86_64", "windows-x86_64-msvc", "windows-x64", "windows"];
    for k in preferred {
        if let Some(v) = platforms.get(k) {
            return Some((v, k.to_string()));
        }
    }
    // Fallback: first key that contains "windows".
    for (k, v) in platforms {
        if k.to_lowercase().contains("windows") {
            return Some((v, k.clone()));
        }
    }
    None
}

async fn fetch_latest_info() -> Result<LatestInfo> {
    let body = reqwest::Client::new()
        .get(UPDATER_ENDPOINT)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .context("fetch latest.json failed")?
        .error_for_status()
        .context("latest.json returned non-2xx")?
        .text()
        .await
        .context("read latest.json body failed")?;

    let json: serde_json::Value = serde_json::from_str(&body).context("latest.json is not valid JSON")?;
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if version.is_empty() {
        anyhow::bail!("latest.json missing version");
    }

    let (plat, _key) = pick_windows_platform(&json).context("latest.json missing windows platform entry")?;
    let url = plat.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let signature = plat
        .get("signature")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if url.is_empty() {
        anyhow::bail!("latest.json windows entry missing url");
    }
    if signature.is_empty() {
        anyhow::bail!("latest.json windows entry missing signature");
    }

    Ok(LatestInfo {
        version,
        url,
        signature,
    })
}

async fn download_file(url: &str, dest: &Path) -> Result<()> {
    let res = reqwest::Client::new()
        .get(url)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .with_context(|| format!("download failed: {url}"))?
        .error_for_status()
        .with_context(|| format!("download non-2xx: {url}"))?;

    let mut stream = res.bytes_stream();
    let mut f = tokio::fs::File::create(dest)
        .await
        .with_context(|| format!("create file failed: {}", dest.display()))?;
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("download chunk failed: {url}"))?;
        f.write_all(&chunk).await?;
    }
    f.flush().await?;
    Ok(())
}

fn verify_msi_signature(msi_bytes: &[u8], signature: &str) -> Result<()> {
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

async fn pipe_call_install(msi_path: &Path) -> Result<()> {
    let mut client = connect_pipe().await?;
    let req = serde_json::json!({
        "action": "install_msi",
        "msi_path": msi_path.to_string_lossy(),
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

/// Download + verify the latest MSI and ask the elevated updater service to install it.
///
/// Designed to be called from the normal user-mode agent process (no UAC).
pub async fn update_via_service() -> Result<()> {
    let latest = fetch_latest_info().await?;
    info!("Updater: latest agent version reported as {}", latest.version);
    let current = env!("CARGO_PKG_VERSION");
    if latest.version.trim_start_matches('v') == current.trim_start_matches('v') {
        info!("Updater: already on latest version ({current}).");
        return Ok(());
    }

    let dir = updates_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .with_context(|| format!("create updates dir failed: {}", dir.display()))?;

    let msi_path = dir.join(format!("SentinelAgent_{}.msi", latest.version));
    let tmp_path = dir.join(format!("SentinelAgent_{}.msi.part", latest.version));

    download_file(&latest.url, &tmp_path).await?;
    let bytes = tokio::fs::read(&tmp_path).await?;
    verify_msi_signature(&bytes, &latest.signature)?;

    // Atomic-ish replace.
    if msi_path.exists() {
        let _ = tokio::fs::remove_file(&msi_path).await;
    }
    tokio::fs::rename(&tmp_path, &msi_path).await?;

    info!("Updater: verified MSI saved to {}", msi_path.display());

    // Ask elevated service to install it.
    pipe_call_install(&msi_path).await?;
    Ok(())
}

/// Helper used by the agent when it knows it's going to be replaced.
pub fn exit_for_update() -> ! {
    warn!("Exiting agent for update install.");
    std::process::exit(0);
}

