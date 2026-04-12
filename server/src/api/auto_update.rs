//! Central agent auto-update policy.

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

use crate::{auth, db, state::AppState, ws_agent};

use super::helpers::{audit_ip, err500};
// ─── Agent auto-update policy (Tauri updater) ─────────────────────────────────

pub async fn agent_auto_update_global_get(State(s): State<Arc<AppState>>) -> Response {
    match db::get_agent_auto_update_global(&s.db).await {
        Ok(enabled) => Json(serde_json::json!({ "enabled": enabled })).into_response(),
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
pub(crate) struct AgentAutoUpdateBody {
    enabled: bool,
}

pub async fn agent_auto_update_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentAutoUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::set_agent_auto_update_global(&s.db, body.enabled).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn agent_auto_update_agent_get(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
) -> Response {
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

pub async fn agent_auto_update_agent_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentAutoUpdateBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::set_agent_auto_update_override(&s.db, id, body.enabled).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn agent_auto_update_agent_delete(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_agent_auto_update_override(&s.db, id).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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
