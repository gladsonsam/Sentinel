//! Windows agent local settings-window password policy.

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
// ─── Agent local UI password (Windows settings window) ───────────────────────

#[derive(Deserialize)]
pub(crate) struct LocalUiPasswordBody {
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

pub async fn local_ui_password_global_get(State(s): State<Arc<AppState>>) -> Response {
    match db::get_local_ui_global_hash(&s.db).await {
        Ok(h) => {
            let password_set = db::agent_ui_password_is_set(h.as_deref());
            Json(serde_json::json!({ "password_set": password_set })).into_response()
        }
        Err(e) => err500(e),
    }
}

pub async fn local_ui_password_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LocalUiPasswordBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    if let Some(ref p) = body.password {
        if let Err(msg) = validate_local_ui_password_plain(p) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    }
    let ip = audit_ip(&headers, addr);
    let hash: Option<String> = match body.password {
        None => None,
        Some(ref p) if p.is_empty() => None,
        Some(ref p) => match db::hash_agent_local_ui_password(p) {
            Ok(h) => Some(h),
            Err(e) => return err500(e),
        },
    };
    match db::set_local_ui_global_hash(&s.db, hash.as_deref()).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn local_ui_password_agent_get(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
) -> Response {
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

pub async fn local_ui_password_agent_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LocalUiPasswordBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    if let Some(ref p) = body.password {
        if let Err(msg) = validate_local_ui_password_plain(p) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    }
    let ip = audit_ip(&headers, addr);
    let hash: Option<String> = match body.password {
        None => None,
        Some(ref p) if p.is_empty() => None,
        Some(ref p) => match db::hash_agent_local_ui_password(p) {
            Ok(h) => Some(h),
            Err(e) => return err500(e),
        },
    };
    match db::set_local_ui_override_hash(&s.db, id, hash.as_deref()).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn local_ui_password_agent_delete(
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
    match db::clear_local_ui_override(&s.db, id).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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
