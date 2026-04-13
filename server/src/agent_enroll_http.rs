//! Public HTTP endpoint for agent adoption (one-time enrollment secret → per-agent API token).

use std::sync::Arc;

use axum::extract::State;
use axum::extract::ConnectInfo;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use std::net::SocketAddr;

use crate::db::{self, EnrollReject};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct EnrollRequestBody {
    pub enrollment_token: String,
    pub agent_name: String,
}

/// `POST /api/agent/enroll` — no dashboard session; rate-limit at the router layer.
pub async fn agent_enroll_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<EnrollRequestBody>,
) -> impl IntoResponse {
    let token = body.enrollment_token.trim();
    let name = body
        .agent_name
        .trim()
        .chars()
        .take(crate::ws_agent::MAX_AGENT_NAME_CHARS)
        .collect::<String>();

    if token.is_empty() || name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "enrollment_token and agent_name required" })),
        )
            .into_response();
    }

    let ip = crate::auth::client_ip_for_audit(&headers, Some(addr));
    match db::enroll_agent_with_secret(&state.db, token, &name, ip.as_deref()).await {
        Ok(Ok(agent_token)) => (
            StatusCode::OK,
            Json(serde_json::json!({ "agent_token": agent_token })),
        )
            .into_response(),
        Ok(Err(EnrollReject::InvalidOrExpired)) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "invalid or expired enrollment token" })),
        )
            .into_response(),
        Ok(Err(EnrollReject::AgentAlreadyEnrolled)) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "agent already enrolled; revoke credentials on the server or pick another name" })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "agent enroll failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "enrollment failed" })),
            )
                .into_response()
        }
    }
}
