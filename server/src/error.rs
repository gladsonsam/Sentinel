//! Shared HTTP error responses.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

/// Return 500 JSON. By default the body is generic; set `EXPOSE_INTERNAL_ERRORS=true` for details.
pub fn internal_error(err: anyhow::Error) -> Response {
    let expose = std::env::var("EXPOSE_INTERNAL_ERRORS")
        .ok()
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if expose {
        tracing::error!(error = %err, "internal error");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response()
    } else {
        tracing::error!(error = %err, "internal error");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Internal server error" })),
        )
            .into_response()
    }
}
