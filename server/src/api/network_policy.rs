//! Per-agent internet block (parental controls).
//!
//! GET  /agents/:id/internet-blocked  → { blocked: bool }
//! PUT  /agents/:id/internet-blocked  ← { blocked: bool }  (admin only)

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

pub async fn agent_internet_blocked_get(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
) -> Response {
    match db::get_agent_internet_blocked(&s.db, id).await {
        Ok(blocked) => Json(serde_json::json!({ "blocked": blocked })).into_response(),
        Err(e) => err500(e),
    }
}

#[derive(Deserialize)]
pub(crate) struct AgentInternetBlockedBody {
    blocked: bool,
}

pub async fn agent_internet_blocked_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AgentInternetBlockedBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::set_agent_internet_blocked(&s.db, id, body.blocked).await {
        Ok(()) => {
            db::insert_audit_log_traced(
                &s.db,
                user.username.as_str(),
                Some(id),
                "set_agent_internet_blocked",
                "ok",
                &serde_json::json!({ "blocked": body.blocked }),
                ip.as_deref(),
            )
            .await;
            ws_agent::push_network_policy_to_agent(&s, id).await;
            agent_internet_blocked_get(Path(id), State(s.clone())).await
        }
        Err(e) => err500(e),
    }
}
