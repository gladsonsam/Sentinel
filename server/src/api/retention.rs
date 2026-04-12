//! Telemetry retention settings.

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
// ─── Retention (telemetry auto-prune) ─────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct RetentionBody {
    keylog_days: Option<i32>,
    window_days: Option<i32>,
    url_days: Option<i32>,
}

/// Global policy: `None` or `0` → unlimited (stored as SQL NULL). Otherwise 1..=36500.
fn normalize_global_retention(body: RetentionBody) -> Result<db::RetentionPolicy, &'static str> {
    let norm = |d: Option<i32>| -> Result<Option<i32>, &'static str> {
        match d {
            None => Ok(None),
            Some(0) => Ok(None),
            Some(x) if (1..=36_500).contains(&x) => Ok(Some(x)),
            Some(x) if x < 0 => Err("retention days cannot be negative"),
            Some(_) => Err("retention days must be 0 (unlimited) or between 1 and 36500"),
        }
    };
    Ok(db::RetentionPolicy {
        keylog_days: norm(body.keylog_days)?,
        window_days: norm(body.window_days)?,
        url_days: norm(body.url_days)?,
    })
}

/// Agent override: `None` → inherit global. `Some(0)` → unlimited. `Some(n)` → n days.
fn parse_agent_retention(body: RetentionBody) -> Result<db::RetentionAgentOverride, &'static str> {
    let parse = |d: Option<i32>| -> Result<Option<i32>, &'static str> {
        match d {
            None => Ok(None),
            Some(0) => Ok(Some(0)),
            Some(x) if (1..=36_500).contains(&x) => Ok(Some(x)),
            Some(x) if x < 0 => Err("retention days cannot be negative"),
            Some(_) => {
                Err("retention override must be omitted (inherit), 0 (unlimited), or 1–36500 days")
            }
        }
    };
    Ok(db::RetentionAgentOverride {
        keylog_days: parse(body.keylog_days)?,
        window_days: parse(body.window_days)?,
        url_days: parse(body.url_days)?,
    })
}

pub async fn retention_global_get(State(s): State<Arc<AppState>>) -> Response {
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

pub async fn retention_global_put(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RetentionBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let p = match normalize_global_retention(body) {
        Ok(p) => p,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    };
    let ip = audit_ip(&headers, addr);
    match db::set_retention_global(&s.db, &p).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn agent_retention_get(Path(id): Path<Uuid>, State(s): State<Arc<AppState>>) -> Response {
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

pub async fn agent_retention_put(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RetentionBody>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ov = match parse_agent_retention(body) {
        Ok(ov) => ov,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    };
    let ip = audit_ip(&headers, addr);
    match db::set_retention_agent(&s.db, id, &ov).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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

pub async fn agent_retention_delete(
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
    match db::clear_retention_agent(&s.db, id).await {
        Ok(()) => {
            db::insert_audit_log_traced(
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
