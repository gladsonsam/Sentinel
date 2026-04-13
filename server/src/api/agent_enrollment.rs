//! Dashboard API: create 6-digit enrollment codes for MDM / imaging (admin only).

use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::{Duration, Utc};
use serde::Deserialize;

use crate::auth;
use crate::db;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateEnrollmentTokenBody {
    /// How many successful adoptions share this secret (default 1).
    #[serde(default = "default_uses")]
    pub uses: i32,
    /// Hours until expiry; omit = no expiry.
    pub expires_in_hours: Option<i64>,
    pub note: Option<String>,
}

fn default_uses() -> i32 {
    1
}

/// Admin: mDNS mode and agent WSS URL for onboarding copy (mirrors `mdns_broadcast` rules).
pub async fn get_agent_setup_hints(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> impl IntoResponse {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }
    let hints = crate::mdns_broadcast::build_agent_setup_hints(state.agent_listen_port);
    (StatusCode::OK, Json(hints)).into_response()
}

pub async fn create_enrollment_token(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    Json(body): Json<CreateEnrollmentTokenBody>,
) -> impl IntoResponse {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }

    let uses = body.uses.max(1).min(100_000);
    let expires_at = match body.expires_in_hours {
        Some(h) if h > 0 => Some(Utc::now() + Duration::hours(h)),
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "expires_in_hours must be positive" })),
            )
                .into_response();
        }
        None => None,
    };

    let note_owned: Option<String> = body
        .note
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match db::create_agent_enrollment_token(&state.db, uses, expires_at, note_owned.as_deref()).await {
        Ok((id, plaintext)) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "id": id,
                "enrollment_token": plaintext,
                "uses": uses,
                "expires_at": expires_at,
                "note": body.note,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "create enrollment token failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "could not create token" })),
            )
                .into_response()
        }
    }
}
