//! REST API for the authenticated dashboard (`/api/*`). Routes are registered in [`router`].

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use axum::extract::Extension;
use bytes::Bytes;
use futures_util::StreamExt;
use regex::RegexBuilder;
use serde::Deserialize;
use uuid::Uuid;

use crate::{auth, db, state::AppState, ws_agent};

fn audit_ip(headers: &HeaderMap, connect: SocketAddr) -> Option<String> {
    auth::client_ip_for_audit(headers, Some(connect))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/me", get(me))
        .route("/agents", get(list_agents))
        .route("/agents/overview", get(list_agents_overview))
        .route("/agents/:id/icon", get(agent_icon_get).put(agent_icon_put))
        .route("/users", get(users_list).post(users_create))
        .route("/users/:id/password", post(user_set_password))
        .route("/users/:id/role", post(user_set_role))
        .route("/users/:id/delete", post(user_delete))
        .route("/users/:id/identities", get(user_identities))
        .route("/users/:id/identities/link", post(user_identity_link))
        .route("/identities/:id/unlink", post(identity_unlink))
        .route("/agents/bulk-script", post(agents_bulk_script))
        .route("/agents/:id/info", get(agent_info))
        .route("/agents/:id/windows", get(agent_windows))
        .route("/agents/:id/keys", get(agent_keys))
        .route("/agents/:id/alert-rule-events", get(agent_alert_rule_events))
        .route("/alert-rule-events/:id/screenshot", get(alert_rule_event_screenshot))
        .route("/agents/:id/urls", get(agent_urls))
        .route("/agents/:id/activity", get(agent_activity))
        .route("/agents/:id/app-icons/:exe_name", get(agent_app_icon))
        .route("/agents/:id/top-urls", get(agent_top_urls))
        .route("/agents/:id/top-windows", get(agent_top_windows))
        .route("/agents/:id/history/clear", post(clear_agent_history))
        .route("/agents/:id/wake", post(agent_wake))
        .route("/agents/:id/software", get(agent_software_list))
        .route("/agents/:id/software/collect", post(agent_software_collect))
        .route("/agents/:id/script", post(agent_run_script))
        .route("/audit", get(audit_log))
        .route(
            "/agents/:id/retention",
            get(agent_retention_get).put(agent_retention_put).delete(agent_retention_delete),
        )
        .route("/agents/:id/screen", get(agent_screen))
        .route("/agents/:id/mjpeg", get(agent_mjpeg))
        .route(
            "/settings/retention",
            get(retention_global_get).put(retention_global_put),
        )
        .route(
            "/settings/local-ui-password",
            get(local_ui_password_global_get).put(local_ui_password_global_put),
        )
        .route(
            "/settings/agent-auto-update",
            get(agent_auto_update_global_get).put(agent_auto_update_global_put),
        )
        .route("/settings/storage", get(storage_usage))
        .route("/settings/capabilities", get(settings_capabilities))
        .route("/settings/version", get(settings_version))
        .route("/settings/integration", get(settings_integration))
        .route(
            "/agents/:id/local-ui-password",
            get(local_ui_password_agent_get)
                .put(local_ui_password_agent_put)
                .delete(local_ui_password_agent_delete),
        )
        .route(
            "/agents/:id/auto-update",
            get(agent_auto_update_agent_get)
                .put(agent_auto_update_agent_put)
                .delete(agent_auto_update_agent_delete),
        )
        .route("/agents/:id/update-now", post(agent_update_now))
        .route("/agent-groups", get(agent_groups_list_h).post(agent_groups_create_h))
        .route(
            "/agent-groups/:group_id",
            put(agent_groups_update_h).delete(agent_groups_delete_h),
        )
        .route(
            "/agent-groups/:group_id/members",
            get(agent_group_members_list_h).post(agent_group_members_add_h),
        )
        .route(
            "/agent-groups/:group_id/members/:agent_id",
            delete(agent_group_member_remove_h),
        )
        .route("/alert-rules", get(alert_rules_list_h).post(alert_rules_create_h))
        .route("/alert-rules/:rule_id/events", get(alert_rule_events_for_rule_h))
        .route(
            "/alert-rules/:rule_id",
            put(alert_rules_update_h).delete(alert_rules_delete_h),
        )
}

// ─── Versions (server + latest GitHub release + agent updater manifest) ─────

/// Public Sentinel repo (server Docker workflow tags `ghcr.io/.../server` from these releases).
const SENTINEL_GITHUB_REPO: &str = "gladsonsam/Sentinel";
const SENTINEL_RELEASES_URL: &str = "https://github.com/gladsonsam/Sentinel/releases";

#[derive(Deserialize)]
struct LatestAgentJson {
    version: String,
}

#[derive(Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
}

/// Avoid hammering GitHub on every dashboard poll; multiple users share this process-local cache.
static SETTINGS_VERSION_CACHE: Mutex<Option<(Instant, serde_json::Value)>> = Mutex::new(None);
const SETTINGS_VERSION_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

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
    if v.is_empty() { None } else { Some(v) }
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
    if v.is_empty() { None } else { Some(v) }
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

async fn settings_version(State(_s): State<Arc<AppState>>) -> Response {
    let now = Instant::now();
    if let Ok(guard) = SETTINGS_VERSION_CACHE.lock() {
        if let Some((t, cached)) = guard.as_ref() {
            if now.duration_since(*t) < SETTINGS_VERSION_CACHE_TTL {
                return Json(cached.clone()).into_response();
            }
        }
    }

    let body = build_settings_version_json().await;
    if let Ok(mut guard) = SETTINGS_VERSION_CACHE.lock() {
        *guard = Some((now, body.clone()));
    }
    Json(body).into_response()
}

// ─── Agent auto-update policy (Tauri updater) ─────────────────────────────────

async fn agent_auto_update_global_get(State(s): State<Arc<AppState>>) -> Response {
    match db::get_agent_auto_update_global(&s.db).await {
        Ok(enabled) => Json(serde_json::json!({ "enabled": enabled })).into_response(),
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
struct AgentAutoUpdateBody {
    enabled: bool,
}

async fn agent_auto_update_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentAutoUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::set_agent_auto_update_global(&s.db, body.enabled).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "set_agent_auto_update_global",
                "ok",
                &serde_json::json!({ "enabled": body.enabled }),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_auto_update_policy_to_all_connected(&s).await;
            agent_auto_update_global_get(State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn agent_auto_update_agent_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
    let global = match db::get_agent_auto_update_global(&s.db).await {
        Ok(v) => v,
        Err(e) => return err500(e),
    };
    let ov = match db::get_agent_auto_update_override(&s.db, id).await {
        Ok(v) => v,
        Err(e) => return err500(e),
    };
    Json(serde_json::json!({
        "global": { "enabled": global },
        "override": match ov {
            None => serde_json::Value::Null,
            Some(v) => serde_json::json!({ "enabled": v }),
        }
    }))
    .into_response()
}

async fn agent_auto_update_agent_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentAutoUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::set_agent_auto_update_override(&s.db, id, body.enabled).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "set_agent_auto_update_override",
                "ok",
                &serde_json::json!({ "enabled": body.enabled }),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_auto_update_policy_to_agent(&s, id).await;
            agent_auto_update_agent_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn agent_auto_update_agent_delete(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_agent_auto_update_override(&s.db, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "clear_agent_auto_update_override",
                "ok",
                &serde_json::json!({}),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_auto_update_policy_to_agent(&s, id).await;
            agent_auto_update_agent_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn agent_app_icon(
    Path((id, exe_name)): Path<(Uuid, String)>,
    State(s): State<Arc<AppState>>,
    Extension(_user): Extension<auth::AuthUser>,
) -> Response {
    // Basic input hardening: only allow a reasonable exe token.
    let exe = exe_name.trim().to_lowercase();
    if exe.is_empty() || exe.len() > 128 {
        return (StatusCode::BAD_REQUEST, "invalid exe_name").into_response();
    }
    if !exe
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' )
    {
        return (StatusCode::BAD_REQUEST, "invalid exe_name").into_response();
    }

    match db::get_app_icon_png(&s.db, id, &exe).await {
        Ok(Some(bytes)) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "public, max-age=604800, immutable"),
            ],
            bytes,
        )
            .into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "no icon").into_response(),
        Err(e) => err500(e),
    }
}

async fn alert_rule_event_screenshot(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Extension(_user): Extension<auth::AuthUser>,
) -> Response {
    match db::alert_rule_event_screenshot_get(&s.db, id).await {
        Ok(Some(bytes)) => (
            [(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "no-store")],
            bytes,
        )
            .into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "No screenshot").into_response(),
        Err(e) => err500(e),
    }
}

async fn me(Extension(user): Extension<auth::AuthUser>) -> Response {
    Json(serde_json::json!({
        "id": user.user_id,
        "username": user.username,
        "role": user.role,
        "csrf_token": user.csrf_token,
    }))
    .into_response()
}

async fn list_agents(State(s): State<Arc<AppState>>) -> Response {
    match db::list_agents(&s.db).await {
        Ok(rows) => Json(serde_json::json!({ "agents": rows })).into_response(),
        Err(e) => err500(e),
    }
}

/// Overview list used by the dashboard sidebar: includes offline agents + last session times.
async fn list_agents_overview(State(s): State<Arc<AppState>>) -> Response {
    let agents = match db::list_agents(&s.db).await {
        Ok(rows) => rows,
        Err(e) => return err500(e),
    };

    let online: std::collections::HashMap<uuid::Uuid, chrono::DateTime<chrono::Utc>> = {
        let map = s.agents.lock().unwrap();
        map.iter().map(|(id, a)| (*id, a.connected_at)).collect()
    };

    let mut out: Vec<serde_json::Value> = Vec::with_capacity(agents.len());
    for a in agents {
        let id = match a["id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
            Some(id) => id,
            None => continue,
        };
        let (last_connected_at, last_disconnected_at) =
            match db::agent_last_session_times(&s.db, id).await {
                Ok(v) => v,
                Err(e) => return err500(e),
            };
        let connected_at = online.get(&id).copied();
        out.push(serde_json::json!({
            "id": id,
            "name": a["name"],
            "first_seen": a["first_seen"],
            "last_seen": a["last_seen"],
            "icon": a["icon"],
            "online": connected_at.is_some(),
            "connected_at": connected_at,
            "last_connected_at": last_connected_at,
            "last_disconnected_at": last_disconnected_at
        }));
    }

    Json(serde_json::json!({ "agents": out })).into_response()
}

#[derive(Deserialize)]
struct AgentIconBody {
    /// Icon key (from the dashboard's icon library); empty or null clears.
    icon: Option<String>,
}

fn normalize_icon(raw: Option<String>) -> Result<Option<String>, &'static str> {
    let Some(s) = raw else { return Ok(Some("monitor".to_string())); };
    let t = s.trim();
    if t.is_empty() {
        return Ok(Some("monitor".to_string()));
    }
    // Keep it lightweight (intended for a short icon key like "laptop").
    if t.len() > 32 {
        return Err("icon is too long (max 32 characters)");
    }
    // Allow a conservative key charset; frontend enforces the actual allowed list.
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("icon must be alphanumeric (plus '-' or '_')");
    }
    Ok(Some(t.to_string()))
}

async fn agent_icon_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
    match db::get_agent_icon(&s.db, id).await {
        Ok(icon) => Json(serde_json::json!({ "icon": icon })).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_icon_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentIconBody>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let icon = match normalize_icon(body.icon) {
        Ok(v) => v,
        Err(msg) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response(),
    };
    let ip = audit_ip(&headers, addr);
    match db::set_agent_icon(&s.db, id, icon.as_deref()).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "set_agent_icon",
                "ok",
                &serde_json::json!({ "icon": icon }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "icon": icon })).into_response()
        }
        Err(e) => err500(e),
    }
}

// ─── Dashboard user management (admin-only) ───────────────────────────────────

#[derive(Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    role: Option<String>,
}

fn normalize_role(raw: Option<String>) -> Result<String, &'static str> {
    let r = raw.unwrap_or_else(|| "viewer".to_string());
    let t = r.trim().to_lowercase();
    if matches!(t.as_str(), "admin" | "operator" | "viewer") {
        Ok(t)
    } else {
        Err("role must be one of: admin, operator, viewer")
    }
}

async fn users_list(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::dashboard_user_list(&s.db).await {
        Ok(rows) => Json(serde_json::json!({ "users": rows })).into_response(),
        Err(e) => err500(e),
    }
}

async fn users_create(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<CreateUserBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let role = match normalize_role(body.role) {
        Ok(r) => r,
        Err(msg) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response(),
    };
    if body.username.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "username is required" }))).into_response();
    }
    if body.password.len() < 6 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "password must be at least 6 characters" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::dashboard_user_create(&s.db, body.username.trim(), &body.password, &role).await {
        Ok(new_id) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "user_create",
                "ok",
                &serde_json::json!({ "user_id": new_id, "username": body.username.trim(), "role": role }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "id": new_id })).into_response()
        }
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

async fn user_set_password(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<PasswordBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if body.password.len() < 6 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "password must be at least 6 characters" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::dashboard_user_set_password(&s.db, id, &body.password).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "user_set_password",
                "ok",
                &serde_json::json!({ "user_id": id }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
struct RoleBody {
    role: String,
}

async fn user_set_role(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RoleBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let role = match normalize_role(Some(body.role)) {
        Ok(r) => r,
        Err(msg) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response(),
    };

    // Safety: do not allow demoting the last remaining admin.
    if role != "admin" {
        let is_target_admin = db::dashboard_user_is_admin(&s.db, id).await.unwrap_or(false);
        if is_target_admin {
            let admin_count = db::dashboard_admin_count(&s.db).await.unwrap_or(0);
            if admin_count <= 1 {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Cannot demote the last admin user" })),
                )
                    .into_response();
            }
        }
    }

    let ip = audit_ip(&headers, addr);
    match db::dashboard_user_set_role(&s.db, id, &role).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "user_set_role",
                "ok",
                &serde_json::json!({ "user_id": id, "role": role }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn user_delete(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if id == user.user_id {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "cannot delete your own user" }))).into_response();
    }

    // Safety: do not allow deleting the last remaining admin.
    let is_target_admin = db::dashboard_user_is_admin(&s.db, id).await.unwrap_or(false);
    if is_target_admin {
        let admin_count = db::dashboard_admin_count(&s.db).await.unwrap_or(0);
        if admin_count <= 1 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Cannot delete the last admin user" })),
            )
                .into_response();
        }
    }

    let ip = audit_ip(&headers, addr);
    match db::dashboard_user_delete(&s.db, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "user_delete",
                "ok",
                &serde_json::json!({ "user_id": id }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn user_identities(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::dashboard_identities_for_user(&s.db, id).await {
        Ok(rows) => Json(serde_json::json!({ "identities": rows })).into_response(),
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
struct IdentityLinkBody {
    issuer: String,
    subject: String,
}

async fn user_identity_link(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<IdentityLinkBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let issuer = body.issuer.trim();
    let subject = body.subject.trim();
    if issuer.is_empty() || subject.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "issuer and subject are required" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::dashboard_identity_link(&s.db, issuer, subject, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "identity_link",
                "ok",
                &serde_json::json!({ "user_id": id, "issuer": issuer, "subject": subject }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn identity_unlink(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::dashboard_identity_unlink(&s.db, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "identity_unlink",
                "ok",
                &serde_json::json!({ "identity_id": id }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
struct PageParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

#[derive(Deserialize)]
struct AuditParams {
    agent_id: Option<Uuid>,
    action: Option<String>,
    status: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

fn validate_page_params(p: &PageParams) -> Result<(), &'static str> {
    // Keep pagination bounded to avoid DB-heavy queries from untrusted clients.
    // (This is still protected by cookie auth for the dashboard API.)
    // The dashboard UI requests limit=500 for URL/Key history pages.
    if !(1..=1000).contains(&p.limit) {
        return Err("limit must be between 1 and 1000");
    }
    if p.offset < 0 || p.offset > 100_000 {
        return Err("offset must be between 0 and 100000");
    }
    Ok(())
}

fn validate_audit_params(p: &AuditParams) -> Result<(), &'static str> {
    if !(1..=1000).contains(&p.limit) {
        return Err("limit must be between 1 and 1000");
    }
    if p.offset < 0 || p.offset > 100_000 {
        return Err("offset must be between 0 and 100000");
    }
    if let Some(ref s) = p.status {
        if !matches!(s.as_str(), "ok" | "error" | "rejected") {
            return Err("status must be one of: ok, error, rejected");
        }
    }
    Ok(())
}

async fn agent_windows(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_windows(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_windows",
                "ok",
                &serde_json::json!({ "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_keys(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_keys(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_keys",
                "ok",
                &serde_json::json!({ "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_urls(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_urls(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_urls",
                "ok",
                &serde_json::json!({ "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn alert_rule_events_for_rule_h(
    Path(rule_id): Path<i64>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "admin only" }))).into_response();
    }
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::alert_rule_events_list_for_rule(&s.db, rule_id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                None,
                "view_alert_rule_events_by_rule",
                "ok",
                &serde_json::json!({ "rule_id": rule_id, "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_alert_rule_events(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::alert_rule_events_list_for_agent(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_alert_rule_events",
                "ok",
                &serde_json::json!({ "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_activity(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_activity(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_activity",
                "ok",
                &serde_json::json!({ "limit": p.limit, "offset": p.offset }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_info(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let ip = audit_ip(&headers, addr);
    match db::get_agent_info(&s.db, id).await {
        Ok(info) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                Some(id),
                "view_specs",
                "ok",
                &serde_json::json!({}),
                15,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "info": info })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn agent_top_urls(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    match db::query_top_urls(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => Json(serde_json::json!({ "rows": rows })).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_top_windows(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    match db::query_top_windows(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => Json(serde_json::json!({ "rows": rows })).into_response(),
        Err(e) => err500(e),
    }
}

/// Clear all stored telemetry history for an agent.
async fn clear_agent_history(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_agent_history(&s.db, id).await {
        Ok(cleared_rows) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "clear_agent_history",
                "ok",
                &serde_json::json!({ "cleared_rows": cleared_rows }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "cleared_rows": cleared_rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

#[derive(Deserialize, Default)]
struct WakeQuery {
    /// IPv4 broadcast address (default `255.255.255.255`).
    broadcast: Option<String>,
    /// UDP port (default 9).
    port: Option<u16>,
}

/// Send a Wake-on-LAN magic packet using MAC from stored `agent_info`.
async fn agent_wake(
    Path(id): Path<Uuid>,
    Query(q): Query<WakeQuery>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    if let Err(retry_secs) = s.wol_throttle_check(id) {
        let _ = db::insert_audit_log(
            &s.db,
            user.username.as_str(),
            Some(id),
            "wake_on_lan",
            "rate_limited",
            &serde_json::json!({ "retry_after_secs": retry_secs }),
            ip.as_deref(),
        )
        .await;
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": format!("Wake-on-LAN for this agent was sent recently; try again in about {retry_secs}s."),
                "retry_after_secs": retry_secs,
            })),
        )
            .into_response();
    }

    let info_val = match db::get_agent_info(&s.db, id).await {
        Ok(v) => v,
        Err(e) => return err500(e),
    };
    let Some(info) = info_val else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "No stored system info for this agent. Connect it once so a MAC address is recorded."
            })),
        )
            .into_response();
    };
    let Some(mac) = crate::wol::mac_bytes_from_agent_info(&info) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No usable MAC address in stored network adapters."
            })),
        )
            .into_response();
    };

    let broadcast = q
        .broadcast
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("255.255.255.255");
    let port = q.port.unwrap_or(9);

    if let Err(e) = crate::wol::send_wake(mac, broadcast, port).await {
        tracing::warn!("WoL UDP send failed for {id}: {e}");
        let _ = db::insert_audit_log(
            &s.db,
            user.username.as_str(),
            Some(id),
            "wake_on_lan",
            "error",
            &serde_json::json!({ "error": e.to_string(), "broadcast": broadcast, "port": port }),
            ip.as_deref(),
        )
        .await;
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("Could not send magic packet: {e}") })),
        )
            .into_response();
    }

    let mac_str = crate::wol::format_mac_colon(&mac);
    s.wol_mark_sent(id);
    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        Some(id),
        "wake_on_lan",
        "ok",
        &serde_json::json!({ "mac": mac_str, "broadcast": broadcast, "port": port }),
        ip.as_deref(),
    )
    .await;

    Json(serde_json::json!({
        "ok": true,
        "mac": mac_str,
        "broadcast": broadcast,
        "port": port,
    }))
    .into_response()
}

async fn audit_log(
    Query(p): Query<AuditParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_audit_params(&p) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }

    let ip = audit_ip(&headers, addr);
    match db::query_audit_log(
        &s.db,
        p.agent_id,
        p.action.as_deref(),
        p.status.as_deref(),
        p.limit,
        p.offset,
    )
    .await
    {
        Ok(rows) => {
            let _ = db::insert_audit_log_dedup(
                &s.db,
                user.username.as_str(),
                p.agent_id,
                "view_audit_log",
                "ok",
                &serde_json::json!({
                    "action_filter": p.action,
                    "status_filter": p.status,
                    "limit": p.limit,
                    "offset": p.offset
                }),
                10,
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}

// ─── Retention (telemetry auto-prune) ─────────────────────────────────────────

#[derive(Deserialize)]
struct RetentionBody {
    keylog_days: Option<i32>,
    window_days: Option<i32>,
    url_days: Option<i32>,
}

fn validate_retention_days(
    keylog_days: Option<i32>,
    window_days: Option<i32>,
    url_days: Option<i32>,
) -> Result<(), &'static str> {
    for d in [keylog_days, window_days, url_days] {
        if let Some(n) = d {
            if !(1..=36_500).contains(&n) {
                return Err("each retention value must be null (forever) or between 1 and 36500 days");
            }
        }
    }
    Ok(())
}

async fn retention_global_get(State(s): State<Arc<AppState>>) -> Response {
    match db::get_retention_global(&s.db).await {
        Ok(p) => Json(serde_json::json!({
            "keylog_days": p.keylog_days,
            "window_days": p.window_days,
            "url_days": p.url_days,
        }))
        .into_response(),
        Err(e) => err500(e),
    }
}

async fn retention_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RetentionBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Err(msg) = validate_retention_days(body.keylog_days, body.window_days, body.url_days) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    let p = db::RetentionPolicy {
        keylog_days: body.keylog_days,
        window_days: body.window_days,
        url_days: body.url_days,
    };
    match db::set_retention_global(&s.db, &p).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "set_retention_global",
                "ok",
                &serde_json::json!({
                    "keylog_days": p.keylog_days,
                    "window_days": p.window_days,
                    "url_days": p.url_days
                }),
                ip.as_deref(),
            )
            .await;
            retention_global_get(State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn agent_retention_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
    let global = match db::get_retention_global(&s.db).await {
        Ok(g) => g,
        Err(e) => return err500(e),
    };
    let ov = match db::get_retention_agent(&s.db, id).await {
        Ok(o) => o,
        Err(e) => return err500(e),
    };
    let override_json = match &ov {
        Some(o) => serde_json::json!({
            "keylog_days": o.keylog_days,
            "window_days": o.window_days,
            "url_days": o.url_days,
        }),
        None => serde_json::Value::Null,
    };

    Json(serde_json::json!({
        "global": {
            "keylog_days": global.keylog_days,
            "window_days": global.window_days,
            "url_days": global.url_days,
        },
        "override": override_json,
    }))
    .into_response()
}

async fn agent_retention_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RetentionBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Err(msg) = validate_retention_days(body.keylog_days, body.window_days, body.url_days) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    let ov = db::RetentionAgentOverride {
        keylog_days: body.keylog_days,
        window_days: body.window_days,
        url_days: body.url_days,
    };
    match db::set_retention_agent(&s.db, id, &ov).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "set_retention_agent",
                "ok",
                &serde_json::json!({
                    "keylog_days": ov.keylog_days,
                    "window_days": ov.window_days,
                    "url_days": ov.url_days
                }),
                ip.as_deref(),
            )
            .await;
            agent_retention_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn agent_retention_delete(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_retention_agent(&s.db, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "clear_retention_agent",
                "ok",
                &serde_json::json!({}),
                ip.as_deref(),
            )
            .await;
            agent_retention_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

// ─── Agent local UI password (Windows settings window) ───────────────────────

#[derive(Deserialize)]
struct LocalUiPasswordBody {
    /// Plaintext; `null` or omitted + empty string = no password (open) or clear override.
    password: Option<String>,
}

fn validate_local_ui_password_plain(p: &str) -> Result<(), &'static str> {
    if p.is_empty() {
        return Ok(());
    }
    if p.len() < 4 {
        return Err("Password must be at least 4 characters, or leave empty to remove.");
    }
    Ok(())
}

async fn local_ui_password_global_get(State(s): State<Arc<AppState>>) -> Response {
    match db::get_local_ui_global_hash(&s.db).await {
        Ok(h) => {
            let password_set = db::agent_ui_password_is_set(h.as_deref());
            Json(serde_json::json!({ "password_set": password_set })).into_response()
        }
        Err(e) => err500(e),
    }
}

async fn local_ui_password_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LocalUiPasswordBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Some(ref p) = body.password {
        if let Err(msg) = validate_local_ui_password_plain(p) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    }
    let ip = audit_ip(&headers, addr);
    let hash = match body.password {
        None => None,
        Some(ref p) if p.is_empty() => None,
        Some(ref p) => Some(db::sha256_hex(p)),
    };
    match db::set_local_ui_global_hash(&s.db, hash.as_deref()).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                None,
                "set_local_ui_password_global",
                "ok",
                &serde_json::json!({ "password_set": hash.is_some() }),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_local_ui_password_to_all_connected(&s).await;
            local_ui_password_global_get(State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn local_ui_password_agent_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
    let global = match db::get_local_ui_global_hash(&s.db).await {
        Ok(h) => h,
        Err(e) => return err500(e),
    };
    let global_set = db::agent_ui_password_is_set(global.as_deref());

    let ov = match db::get_local_ui_override_hash(&s.db, id).await {
        Ok(h) => h,
        Err(e) => return err500(e),
    };
    let override_json = match ov {
        None => serde_json::Value::Null,
        Some(h) => serde_json::json!({ "password_set": db::agent_ui_password_is_set(Some(&h)) }),
    };

    Json(serde_json::json!({
        "global": { "password_set": global_set },
        "override": override_json,
    }))
    .into_response()
}

async fn local_ui_password_agent_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LocalUiPasswordBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Some(ref p) = body.password {
        if let Err(msg) = validate_local_ui_password_plain(p) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    }
    let ip = audit_ip(&headers, addr);
    let hash = match body.password {
        None => None,
        Some(ref p) if p.is_empty() => None,
        Some(ref p) => Some(db::sha256_hex(p)),
    };
    match db::set_local_ui_override_hash(&s.db, id, hash.as_deref()).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "set_local_ui_password_override",
                "ok",
                &serde_json::json!({ "password_set": hash.is_some() }),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_local_ui_password_hash_to_agent(&s, id).await;
            local_ui_password_agent_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn local_ui_password_agent_delete(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_local_ui_override(&s.db, id).await {
        Ok(()) => {
            let _ = db::insert_audit_log(
                &s.db,
                user.username.as_str(),
                Some(id),
                "clear_local_ui_password_override",
                "ok",
                &serde_json::json!({}),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_local_ui_password_hash_to_agent(&s, id).await;
            local_ui_password_agent_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}

async fn settings_capabilities(State(s): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({
        "remote_script": s.allow_remote_script,
    }))
    .into_response()
}

/// Hints for Home Assistant / other integrations (no secrets).
async fn settings_integration(
    State(s): State<Arc<AppState>>,
    Extension(_user): Extension<auth::AuthUser>,
) -> Response {
    Json(serde_json::json!({
        "enabled": s.integration_api_token.is_some(),
        "live_path": "/api/integration/agents/live",
        "auth_header": "Authorization: Bearer <INTEGRATION_API_TOKEN>",
        "setup": "Optional: set INTEGRATION_API_TOKEN on the server to expose GET /api/integration/agents/live for your own scripts or tools (Bearer token). Home Assistant alert automations use HOME_ASSISTANT_URL + HOME_ASSISTANT_ACCESS_TOKEN and the configured event type instead.",
    }))
    .into_response()
}

async fn storage_usage(State(s): State<Arc<AppState>>) -> Response {
    match db::query_database_storage(&s.db).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_update_now(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let ip = audit_ip(&headers, addr);

    let payload = serde_json::json!({ "type": "update_now" }).to_string();
    let sent = if let Some(tx) = s.agent_cmds.lock().unwrap().get(&id) {
        tx.send(payload).is_ok()
    } else {
        false
    };

    if !sent {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Agent is not connected" })),
        )
            .into_response();
    }

    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        Some(id),
        "agent_update_now",
        "ok",
        &serde_json::json!({}),
        ip.as_deref(),
    )
    .await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// Serve the most-recent JPEG screenshot as a single image.
async fn agent_screen(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let frame = s.frames.lock().unwrap().get(&id).cloned();
    match frame {
        Some(f) => (
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::CACHE_CONTROL, "no-cache, no-store"),
            ],
            f.jpeg,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "No frame available yet").into_response(),
    }
}

/// `multipart/x-mixed-replace` MJPEG; polls cached frames every 200ms. Viewer refcount
/// drives `start_capture` / `stop_capture` on the agent (guard dropped when HTTP ends).
async fn agent_mjpeg(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    const BOUNDARY: &str = "mjpegframe";

    let first_viewer = {
        let mut counts = s.capture_viewers.lock().unwrap();
        let count = counts.entry(id).or_insert(0);
        *count += 1;
        *count == 1
    };

    if first_viewer {
        if let Some(tx) = s.agent_cmds.lock().unwrap().get(&id) {
            let _ = tx.send(r#"{"type":"start_capture"}"#.to_string());
        }
    }

    let guard = CaptureGuard {
        agent_id: id,
        state: s.clone(),
    };

    let stream_state = s.clone();
    let stream = async_stream::stream! {
        // Moving the guard into the stream keeps it alive until the HTTP
        // connection drops, at which point Drop sends stop_capture.
        let _guard = guard;

        let mut interval = tokio::time::interval(Duration::from_millis(200));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_seq: u64 = 0;
        // Track whether the agent was reachable on the previous tick so we can
        // re-issue start_capture the moment it comes back online (the agent
        // always stops capture when its WebSocket session ends, so it needs a
        // fresh start_capture even if the MJPEG HTTP connection never dropped).
        let mut agent_was_online = false;

        loop {
            interval.tick().await;

            let agent_online = stream_state.agents.lock().unwrap().contains_key(&id);

            // Agent just (re)connected while we're still watching — send a
            // fresh start_capture so frames start flowing again.
            if agent_online && !agent_was_online {
                if let Some(tx) = stream_state.agent_cmds.lock().unwrap().get(&id) {
                    let _ = tx.send(r#"{"type":"start_capture"}"#.to_string());
                }
            }
            agent_was_online = agent_online;

            let frame = stream_state.frames.lock().unwrap().get(&id).cloned();

            let Some(f) = frame else {
                // Agent not connected yet — keep the connection alive.
                continue;
            };

            // Skip frames we've already sent.
            if f.seq == last_seq {
                continue;
            }
            last_seq = f.seq;

            let header = format!(
                "--{BOUNDARY}\r\n\
                 Content-Type: image/jpeg\r\n\
                 Content-Length: {}\r\n\
                 \r\n",
                f.jpeg.len()
            );

            let mut part: Vec<u8> = header.into_bytes();
            part.extend_from_slice(&f.jpeg);
            part.extend_from_slice(b"\r\n");

            yield Bytes::from(part);
        }
    };

    let result_stream = stream.map(|b| -> Result<Bytes, Infallible> { Ok(b) });

    Response::builder()
        .status(200)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/x-mixed-replace; boundary={BOUNDARY}"),
        )
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header("Connection", "keep-alive")
        .body(Body::from_stream(result_stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ─── Software inventory & remote scripts ─────────────────────────────────────

const MAX_SCRIPT_BODY_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
struct RunScriptBody {
    shell: String,
    script: String,
    #[serde(default)]
    timeout_secs: Option<u64>,
}

#[derive(Deserialize)]
struct BulkScriptBody {
    agent_ids: Vec<Uuid>,
    shell: String,
    script: String,
    #[serde(default)]
    timeout_secs: Option<u64>,
}

#[derive(Deserialize, Default)]
struct SoftwareListQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn agent_software_list(
    Path(id): Path<Uuid>,
    Query(q): Query<SoftwareListQuery>,
    State(s): State<Arc<AppState>>,
) -> Response {
    let paged = q.limit.is_some() || q.offset.is_some();
    if paged {
        let limit = q.limit.unwrap_or(500);
        let offset = q.offset.unwrap_or(0);
        if !(1..=5000).contains(&limit) {
            return crate::error::api_json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "limit must be between 1 and 5000",
            );
        }
        if offset < 0 || offset > 500_000 {
            return crate::error::api_json_error(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "offset must be between 0 and 500000",
            );
        }
        match db::list_agent_software_paged(&s.db, id, limit, offset).await {
            Ok((rows, total)) => {
                let last = db::latest_software_capture_time(&s.db, id)
                    .await
                    .unwrap_or(None);
                Json(serde_json::json!({
                    "rows": rows,
                    "last_captured_at": last,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                }))
                .into_response()
            }
            Err(e) => err500(e),
        }
    } else {
        match db::list_agent_software(&s.db, id).await {
            Ok(rows) => {
                let last = db::latest_software_capture_time(&s.db, id)
                    .await
                    .unwrap_or(None);
                Json(serde_json::json!({
                    "rows": rows,
                    "last_captured_at": last,
                }))
                .into_response()
            }
            Err(e) => err500(e),
        }
    }
}

fn idempotency_key_from_headers(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get("idempotency-key")
        .or_else(|| headers.get("Idempotency-Key"))?;
    let s = raw.to_str().ok()?.trim();
    if s.is_empty() || s.len() > 128 {
        return None;
    }
    Some(s.to_string())
}

const SOFTWARE_COLLECT_IDEMPOTENCY_TTL: Duration = Duration::from_secs(120);

async fn agent_software_collect(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return crate::error::api_json_error(StatusCode::FORBIDDEN, "forbidden", "Forbidden");
    }
    let ip = audit_ip(&headers, addr);

    if let Some(key) = idempotency_key_from_headers(&headers) {
        let now = Instant::now();
        let mut map = s.software_collect_dedup.lock().unwrap();
        map.retain(|_, t| now.duration_since(*t) < SOFTWARE_COLLECT_IDEMPOTENCY_TTL);
        if map.contains_key(&(id, key.clone())) {
            return Json(serde_json::json!({
                "ok": true,
                "idempotent_replay": true
            }))
            .into_response();
        }
        map.insert((id, key), now);
    }

    let cmd = serde_json::json!({ "type": "CollectSoftware" });
    if !s.try_send_agent_command_json(id, &cmd) {
        if let Some(key) = idempotency_key_from_headers(&headers) {
            s.software_collect_dedup.lock().unwrap().remove(&(id, key));
        }
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "Agent is not connected.",
                "code": "agent_offline",
            })),
        )
            .into_response();
    }
    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        Some(id),
        "software_collect",
        "ok",
        &serde_json::json!({}),
        ip.as_deref(),
    )
    .await;
    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn run_script_and_wait(
    s: Arc<AppState>,
    agent_id: Uuid,
    shell: String,
    script: String,
    timeout: u64,
) -> serde_json::Value {
    let rid = Uuid::new_v4();
    let (tx, rx) = oneshot::channel();
    s.register_script_waiter(rid, tx);
    let cmd = serde_json::json!({
        "type": "RunScript",
        "request_id": rid.to_string(),
        "shell": shell,
        "script": script,
        "timeout_secs": timeout,
    });
    if !s.try_send_agent_command_json(agent_id, &cmd) {
        s.remove_script_waiter(rid);
        return serde_json::json!({
            "agent_id": agent_id,
            "ok": false,
            "error": "Agent is not connected.",
        });
    }
    let wait = Duration::from_secs((timeout + 15).min(330));
    match tokio::time::timeout(wait, rx).await {
        Ok(Ok(mut val)) => {
            if let Some(o) = val.as_object_mut() {
                o.insert(
                    "agent_id".to_string(),
                    serde_json::Value::String(agent_id.to_string()),
                );
            }
            val
        }
        Ok(Err(_)) => serde_json::json!({
            "agent_id": agent_id,
            "ok": false,
            "error": "Internal wait channel closed.",
        }),
        Err(_) => {
            s.remove_script_waiter(rid);
            serde_json::json!({
                "agent_id": agent_id,
                "ok": false,
                "error": "Timed out waiting for script result.",
                "request_id": rid,
            })
        }
    }
}

async fn agent_run_script(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RunScriptBody>,
) -> Response {
    let ip = audit_ip(&headers, addr);
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if !s.allow_remote_script {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Remote script execution is disabled. Set ALLOW_REMOTE_SCRIPT_EXECUTION=true on the server (high risk)."
            })),
        )
            .into_response();
    }
    let shell = body.shell.to_lowercase();
    if shell != "powershell" && shell != "cmd" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "shell must be \"powershell\" or \"cmd\"" })),
        )
            .into_response();
    }
    if body.script.len() > MAX_SCRIPT_BODY_BYTES {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "script exceeds maximum size" })),
        )
            .into_response();
    }
    let timeout = body.timeout_secs.unwrap_or(120).clamp(5, 300);
    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        Some(id),
        "remote_script",
        "dispatched",
        &serde_json::json!({ "shell": shell }),
        ip.as_deref(),
    )
    .await;
    let val = run_script_and_wait(s.clone(), id, shell.clone(), body.script, timeout).await;
    let audit_status = if val.get("ok") == Some(&serde_json::json!(false))
        || val.get("error").is_some() && val.get("exit_code").is_none()
    {
        "error"
    } else {
        "ok"
    };
    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        Some(id),
        "remote_script",
        audit_status,
        &serde_json::json!({
            "shell": shell,
            "exit_code": val.get("exit_code"),
        }),
        ip.as_deref(),
    )
    .await;
    Json(val).into_response()
}

async fn agents_bulk_script(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<BulkScriptBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if !s.allow_remote_script {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Remote script execution is disabled. Set ALLOW_REMOTE_SCRIPT_EXECUTION=true on the server (high risk)."
            })),
        )
            .into_response();
    }
    if body.agent_ids.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "agent_ids must be non-empty" })),
        )
            .into_response();
    }
    if body.agent_ids.len() > 64 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "at most 64 agents per bulk request" })),
        )
            .into_response();
    }
    let shell = body.shell.to_lowercase();
    if shell != "powershell" && shell != "cmd" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "shell must be \"powershell\" or \"cmd\"" })),
        )
            .into_response();
    }
    if body.script.len() > MAX_SCRIPT_BODY_BYTES {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "script exceeds maximum size" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    let timeout = body.timeout_secs.unwrap_or(120).clamp(5, 300);
    let s2 = s.clone();
    let script = body.script;
    let futs: Vec<_> = body
        .agent_ids
        .into_iter()
        .map(|aid| {
            let s3 = s2.clone();
            let sh = shell.clone();
            let sc = script.clone();
            async move { run_script_and_wait(s3, aid, sh, sc, timeout).await }
        })
        .collect();
    let results = futures_util::future::join_all(futs).await;
    let _ = db::insert_audit_log(
        &s.db,
        user.username.as_str(),
        None,
        "remote_script_bulk",
        "ok",
        &serde_json::json!({ "count": results.len(), "shell": shell }),
        ip.as_deref(),
    )
    .await;
    Json(serde_json::json!({ "results": results })).into_response()
}

// ─── Agent groups & alert rules (admin) ───────────────────────────────────────

#[derive(Deserialize)]
struct AgentGroupCreateBody {
    name: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
struct AgentGroupUpdateBody {
    name: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
struct AgentGroupMembersAddBody {
    agent_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
struct AlertRuleScopeIn {
    kind: String,
    #[serde(default)]
    group_id: Option<Uuid>,
    #[serde(default)]
    agent_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct AlertRuleCreateBody {
    #[serde(default)]
    name: String,
    channel: String,
    pattern: String,
    #[serde(default = "default_match_mode")]
    match_mode: String,
    #[serde(default = "default_true")]
    case_insensitive: bool,
    #[serde(default = "default_cooldown_secs")]
    cooldown_secs: i32,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    take_screenshot: bool,
    scopes: Vec<AlertRuleScopeIn>,
}

#[derive(Deserialize)]
struct AlertRuleUpdateBody {
    #[serde(default)]
    name: String,
    channel: String,
    pattern: String,
    #[serde(default = "default_match_mode")]
    match_mode: String,
    #[serde(default = "default_true")]
    case_insensitive: bool,
    #[serde(default = "default_cooldown_secs")]
    cooldown_secs: i32,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    take_screenshot: bool,
    scopes: Vec<AlertRuleScopeIn>,
}

fn default_match_mode() -> String {
    "substring".to_string()
}

fn default_true() -> bool {
    true
}

fn default_cooldown_secs() -> i32 {
    300
}

fn normalize_alert_scopes(
    scopes: &[AlertRuleScopeIn],
) -> Result<Vec<(String, Option<Uuid>, Option<Uuid>)>, &'static str> {
    if scopes.is_empty() {
        return Err("at least one scope is required");
    }
    let mut out = Vec::with_capacity(scopes.len());
    for s in scopes {
        match s.kind.as_str() {
            "all" if s.group_id.is_none() && s.agent_id.is_none() => {
                out.push(("all".to_string(), None, None));
            }
            "group" if s.group_id.is_some() && s.agent_id.is_none() => {
                out.push(("group".to_string(), s.group_id, None));
            }
            "agent" if s.agent_id.is_some() && s.group_id.is_none() => {
                out.push(("agent".to_string(), None, s.agent_id));
            }
            _ => {
                return Err(
                    "each scope must be { kind: \"all\" } or { kind: \"group\", group_id } or { kind: \"agent\", agent_id }",
                );
            }
        }
    }
    Ok(out)
}

fn validate_alert_rule_pattern(
    channel: &str,
    match_mode: &str,
    pattern: &str,
    case_insensitive: bool,
) -> Result<(), String> {
    if channel != "url" && channel != "keys" {
        return Err("channel must be \"url\" or \"keys\"".to_string());
    }
    if match_mode != "substring" && match_mode != "regex" {
        return Err("match_mode must be \"substring\" or \"regex\"".to_string());
    }
    if pattern.trim().is_empty() {
        return Err("pattern must be non-empty".to_string());
    }
    if match_mode == "regex" {
        RegexBuilder::new(pattern)
            .case_insensitive(case_insensitive)
            .build()
            .map_err(|e| format!("invalid regex: {e}"))?;
    }
    Ok(())
}

async fn agent_groups_list_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::agent_groups_list(&s.db).await {
        Ok(groups) => Json(serde_json::json!({ "groups": groups })).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_groups_create_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Json(body): Json<AgentGroupCreateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let name = body.name.trim();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "name is required" })),
        )
            .into_response();
    }
    match db::agent_group_create(&s.db, name, body.description.trim()).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_groups_update_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<AgentGroupUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    let name = body.name.trim();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "name is required" })),
        )
            .into_response();
    }
    match db::agent_group_rename(&s.db, group_id, name, body.description.trim()).await {
        Ok(true) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Group not found" })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_groups_delete_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(group_id): Path<Uuid>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::agent_group_delete(&s.db, group_id).await {
        Ok(true) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Group not found" })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_group_members_list_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(group_id): Path<Uuid>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::agent_group_members(&s.db, group_id).await {
        Ok(ids) => Json(serde_json::json!({ "agent_ids": ids })).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_group_members_add_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<AgentGroupMembersAddBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if body.agent_ids.len() > 512 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "at most 512 agent_ids per request" })),
        )
            .into_response();
    }
    match db::agent_group_add_members(&s.db, group_id, &body.agent_ids).await {
        Ok(n) => Json(serde_json::json!({ "added": n })).into_response(),
        Err(e) => err500(e),
    }
}

async fn agent_group_member_remove_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path((group_id, agent_id)): Path<(Uuid, Uuid)>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::agent_group_remove_member(&s.db, group_id, agent_id).await {
        Ok(true) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Membership not found" })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

async fn alert_rules_list_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::alert_rules_list_all(&s.db).await {
        Ok(rules) => Json(serde_json::json!({ "rules": rules })).into_response(),
        Err(e) => err500(e),
    }
}

async fn alert_rules_create_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Json(body): Json<AlertRuleCreateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Err(msg) = validate_alert_rule_pattern(
        body.channel.trim(),
        body.match_mode.trim(),
        body.pattern.trim(),
        body.case_insensitive,
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let scopes = match normalize_alert_scopes(&body.scopes) {
        Ok(s) => s,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    };
    match db::alert_rule_create_with_scopes(
        &s.db,
        body.name.trim(),
        body.channel.trim(),
        body.pattern.trim(),
        body.match_mode.trim(),
        body.case_insensitive,
        body.cooldown_secs,
        body.enabled,
        body.take_screenshot,
        &scopes,
    )
    .await
    {
        Ok(id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "id": id })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

async fn alert_rules_update_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(rule_id): Path<i64>,
    Json(body): Json<AlertRuleUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    if let Err(msg) = validate_alert_rule_pattern(
        body.channel.trim(),
        body.match_mode.trim(),
        body.pattern.trim(),
        body.case_insensitive,
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let scopes = match normalize_alert_scopes(&body.scopes) {
        Ok(s) => s,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    };
    match db::alert_rule_update_with_scopes(
        &s.db,
        rule_id,
        body.name.trim(),
        body.channel.trim(),
        body.pattern.trim(),
        body.match_mode.trim(),
        body.case_insensitive,
        body.cooldown_secs,
        body.enabled,
        body.take_screenshot,
        &scopes,
    )
    .await
    {
        Ok(true) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Rule not found" })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

async fn alert_rules_delete_h(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Path(rule_id): Path<i64>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match db::alert_rule_delete(&s.db, rule_id).await {
        Ok(true) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Rule not found" })),
        )
            .into_response(),
        Err(e) => err500(e),
    }
}

// ─── RAII capture guard ───────────────────────────────────────────────────────

/// Decrements the MJPEG viewer count for `agent_id` when dropped.
/// If the count reaches zero, sends `{"type":"stop_capture"}` to the agent.
struct CaptureGuard {
    agent_id: Uuid,
    state: Arc<AppState>,
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        let should_stop = {
            let mut counts = self.state.capture_viewers.lock().unwrap();
            if let Some(count) = counts.get_mut(&self.agent_id) {
                *count = count.saturating_sub(1);
                *count == 0
            } else {
                false
            }
        };

        if should_stop {
            if let Some(tx) = self.state.agent_cmds.lock().unwrap().get(&self.agent_id) {
                let _ = tx.send(r#"{"type":"stop_capture"}"#.to_string());
            }
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn err500(e: anyhow::Error) -> Response {
    crate::error::internal_error(e)
}
