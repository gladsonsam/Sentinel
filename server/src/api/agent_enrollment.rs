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
use uuid::Uuid;

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

/// Admin: list enrollment tokens (metadata + remaining uses).
pub async fn list_enrollment_tokens(
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
    match db::list_agent_enrollment_tokens(&state.db).await {
        Ok(rows) => (StatusCode::OK, Json(serde_json::json!({ "tokens": rows }))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list enrollment tokens failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "could not list tokens" })),
            )
                .into_response()
        }
    }
}

/// Admin: revoke an enrollment token (sets uses_remaining = 0).
pub async fn revoke_enrollment_token(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    axum::extract::Path(token_id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }
    match db::revoke_agent_enrollment_token(&state.db, token_id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, token_id = %token_id, "revoke enrollment token failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "could not revoke token" })),
            )
                .into_response()
        }
    }
}

/// Admin: revoke all enrollment tokens (sets uses_remaining = 0 for all).
pub async fn revoke_all_enrollment_tokens(
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
    match db::revoke_all_agent_enrollment_tokens(&state.db).await {
        Ok(n) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "revoked": n }))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "revoke all enrollment tokens failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "could not revoke tokens" })),
            )
                .into_response()
        }
    }
}

/// Admin: list recent uses of a given enrollment token.
pub async fn list_enrollment_token_uses(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    axum::extract::Path(token_id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }
    match db::list_agent_enrollment_token_uses(&state.db, token_id, 200).await {
        Ok(rows) => (StatusCode::OK, Json(serde_json::json!({ "uses": rows }))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, token_id = %token_id, "list enrollment token uses failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "could not list token uses" })),
            )
                .into_response()
        }
    }
}
