//! Dashboard version / update metadata (GitHub + agent manifest).

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use parking_lot::Mutex;
use serde::Deserialize;

use crate::state::AppState;

// ─── Versions (server + latest GitHub release + agent updater manifest) ─────

/// Public Sentinel repo (server Docker workflow tags `ghcr.io/.../server` from these releases).
const SENTINEL_GITHUB_REPO: &str = "gladsonsam/Sentinel";
const SENTINEL_RELEASES_URL: &str = "https://github.com/gladsonsam/Sentinel/releases";

#[derive(Deserialize)]
pub(crate) struct LatestAgentJson {
    version: String,
}

#[derive(Deserialize)]
pub(crate) struct GitHubLatestRelease {
    tag_name: String,
}

/// Avoid hammering GitHub on every dashboard poll; multiple users share this process-local cache.
static SETTINGS_VERSION_CACHE: Mutex<Option<(Instant, serde_json::Value)>> = Mutex::new(None);
/// Keep dashboard/settings version checks reasonably fresh without hammering GitHub.
const SETTINGS_VERSION_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

async fn fetch_latest_agent_version() -> Option<String> {
    let url = "https://github.com/gladsonsam/Sentinel/releases/latest/download/latest.json";
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<LatestAgentJson>().await.ok()?;
    let v = body.version.trim().trim_start_matches('v').to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

async fn fetch_latest_github_release_version() -> Option<String> {
    let url = format!("https://api.github.com/repos/{SENTINEL_GITHUB_REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let resp = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "sentinel-server/version-check")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<GitHubLatestRelease>().await.ok()?;
    let v = body.tag_name.trim().trim_start_matches('v').to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn semver_is_newer(latest: &str, current: &str) -> bool {
    match (
        semver::Version::parse(latest),
        semver::Version::parse(current),
    ) {
        (Ok(l), Ok(c)) => l > c,
        _ => false,
    }
}

#[derive(Deserialize, Default)]
pub(crate) struct SettingsVersionQuery {
    /// When true, skip process-local cache and fetch GitHub (and agent manifest) again.
    #[serde(default)]
    nocache: bool,
}

async fn build_settings_version_json() -> serde_json::Value {
    let server_version = env!("CARGO_PKG_VERSION").to_string();
    let (latest_server_release, latest_agent_version) = tokio::join!(
        fetch_latest_github_release_version(),
        fetch_latest_agent_version(),
    );
    let server_update_available = latest_server_release
        .as_deref()
        .map(|l| semver_is_newer(l, server_version.as_str()))
        .unwrap_or(false);

    serde_json::json!({
        "server_version": server_version,
        "latest_server_release": latest_server_release,
        "server_update_available": server_update_available,
        "latest_agent_version": latest_agent_version,
        "releases_url": SENTINEL_RELEASES_URL,
    })
}

pub async fn settings_version(
    Query(q): Query<SettingsVersionQuery>,
    State(_s): State<Arc<AppState>>,
) -> Response {
    let now = Instant::now();
    if !q.nocache {
        let guard = SETTINGS_VERSION_CACHE.lock();
        if let Some((t, cached)) = guard.as_ref() {
            if now.duration_since(*t) < SETTINGS_VERSION_CACHE_TTL {
                return Json(cached.clone()).into_response();
            }
        }
    }

    let body = build_settings_version_json().await;
    *SETTINGS_VERSION_CACHE.lock() = Some((now, body.clone()));
    Json(body).into_response()
}
