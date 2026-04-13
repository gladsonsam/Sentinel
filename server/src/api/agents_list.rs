//! Agent directory, overview, and icon API.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::Extension;
use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{auth, db, state::AppState};

use super::helpers::{audit_ip, err500};

#[derive(Deserialize)]
pub struct BulkAgentIdsBody {
    pub agent_ids: Vec<Uuid>,
}

/// Admin: clear the stored per-agent API token so the agent can enroll again.
pub async fn revoke_agent_credentials(
    Path(agent_id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }
    match db::revoke_agent_credentials(&s.db, agent_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => err500(e),
    }
}

/// Admin: delete agents (forgets them). Cascades telemetry via FK `ON DELETE CASCADE`.
pub async fn delete_agents_bulk(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<BulkAgentIdsBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
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
    if body.agent_ids.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "at most 128 agents per request" })),
        )
            .into_response();
    }

    // Best-effort: disconnect any connected agents first, then delete.
    // This keeps the UX as a single action.
    let mut connected: Vec<Uuid> = {
        let map = s.agents.lock();
        body.agent_ids
            .iter()
            .copied()
            .filter(|id| map.contains_key(id))
            .collect()
    };
    if !connected.is_empty() {
        for id in &connected {
            let _ = s.try_disconnect_agent(*id);
        }
        // Wait briefly for cleanup in `ws_agent::run` to remove them from `s.agents`.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let still: Vec<Uuid> = {
                let map = s.agents.lock();
                connected.iter().copied().filter(|id| map.contains_key(id)).collect()
            };
            if still.is_empty() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "error": "could not disconnect one or more agents in time; retry",
                        "connected_agent_ids": still
                    })),
                )
                    .into_response();
            }
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        }
        connected.clear();
    }

    let ip = audit_ip(&headers, addr);
    match db::delete_agents_by_ids(&s.db, &body.agent_ids).await {
        Ok(n) => {
            db::insert_audit_log_traced(
                &s.db,
                user.username.as_str(),
                None,
                "agents_delete",
                "ok",
                &serde_json::json!({ "count": n, "agent_ids": body.agent_ids }),
                ip.as_deref(),
            )
            .await;
            Json(serde_json::json!({ "ok": true, "deleted": n })).into_response()
        }
        Err(e) => err500(e),
    }
}
pub async fn me(Extension(user): Extension<auth::AuthUser>) -> Response {
    Json(serde_json::json!({
        "id": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "display_icon": user.display_icon,
        "csrf_token": user.csrf_token,
    }))
    .into_response()
}

pub async fn list_agents(State(s): State<Arc<AppState>>) -> Response {
    match db::list_agents(&s.db).await {
        Ok(rows) => Json(serde_json::json!({ "agents": rows })).into_response(),
        Err(e) => err500(e),
    }
}

/// Overview list used by the dashboard sidebar: includes offline agents + last session times.
pub async fn list_agents_overview(State(s): State<Arc<AppState>>) -> Response {
    let agents = match db::list_agents(&s.db).await {
        Ok(rows) => rows,
        Err(e) => return err500(e),
    };

    let online: std::collections::HashMap<uuid::Uuid, chrono::DateTime<chrono::Utc>> = {
        let map = s.agents.lock();
        map.iter().map(|(id, a)| (*id, a.connected_at)).collect()
    };

    let agent_ids: Vec<Uuid> = agents
        .iter()
        .filter_map(|a| a["id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    let session_times = match db::agent_last_session_times_batch(&s.db, &agent_ids).await {
        Ok(m) => m,
        Err(e) => return err500(e),
    };

    let mut out: Vec<serde_json::Value> = Vec::with_capacity(agents.len());
    for a in agents {
        let id = match a["id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
            Some(id) => id,
            None => continue,
        };
        let (last_connected_at, last_disconnected_at) = session_times
            .get(&id)
            .copied()
            .unwrap_or((None, None));
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
pub(crate) struct AgentIconBody {
    /// Icon key (from the dashboard's icon library); empty or null clears.
    icon: Option<String>,
}

fn normalize_icon(raw: Option<String>) -> Result<Option<String>, &'static str> {
    let Some(s) = raw else {
        return Ok(Some("monitor".to_string()));
    };
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

pub async fn agent_icon_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
    match db::get_agent_icon(&s.db, id).await {
        Ok(icon) => Json(serde_json::json!({ "icon": icon })).into_response(),
        Err(e) => err500(e),
    }
}

pub async fn agent_icon_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentIconBody>,
) -> Response {
    if !user.is_operator() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let icon = match normalize_icon(body.icon) {
        Ok(v) => v,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    };
    let ip = audit_ip(&headers, addr);
    match db::set_agent_icon(&s.db, id, icon.as_deref()).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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
