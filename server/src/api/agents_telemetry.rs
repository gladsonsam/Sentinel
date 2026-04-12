//! Per-agent history: windows, keys, URLs, activity, WoL, etc.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::Extension;
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{auth, db, state::AppState};

use super::helpers::{audit_ip, err500};

use super::pagination::{validate_page_params, PageParams};
pub async fn agent_windows(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_windows(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn agent_keys(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_keys(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn agent_urls(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_urls(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn alert_rule_events_for_rule_h(
    Path(rule_id): Path<i64>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin only" })),
        )
            .into_response();
    }
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::alert_rule_events_list_for_rule(&s.db, rule_id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn agent_alert_rule_events(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::alert_rule_events_list_for_agent(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

/// List agent groups that include this agent (admin only; used by dashboard membership UI).
pub async fn agent_agent_groups_for_agent_h(
    Path(agent_id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    match db::agent_groups_for_agent(&s.db, agent_id).await {
        Ok(groups) => Json(serde_json::json!({ "groups": groups })).into_response(),
        Err(e) => err500(e),
    }
}

pub async fn agent_activity(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::query_activity(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn agent_info(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let ip = audit_ip(&headers, addr);
    match db::get_agent_info(&s.db, id).await {
        Ok(info) => {
            db::insert_audit_log_dedup_traced(
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

pub async fn agent_top_urls(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    match db::query_top_urls(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => Json(serde_json::json!({ "rows": rows })).into_response(),
        Err(e) => err500(e),
    }
}

pub async fn agent_top_windows(
    Path(id): Path<Uuid>,
    Query(p): Query<PageParams>,
    State(s): State<Arc<AppState>>,
) -> Response {
    if let Err(msg) = validate_page_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }
    match db::query_top_windows(&s.db, id, p.limit, p.offset).await {
        Ok(rows) => Json(serde_json::json!({ "rows": rows })).into_response(),
        Err(e) => err500(e),
    }
}

/// Clear all stored telemetry history for an agent.
pub async fn clear_agent_history(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    match db::clear_agent_history(&s.db, id).await {
        Ok(cleared_rows) => {
            db::insert_audit_log_traced(
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
pub(crate) struct WakeQuery {
    /// IPv4 broadcast address (default `255.255.255.255`).
    broadcast: Option<String>,
    /// UDP port (default 9).
    port: Option<u16>,
}

/// Send a Wake-on-LAN magic packet using MAC from stored `agent_info`.
pub async fn agent_wake(
    Path(id): Path<Uuid>,
    Query(q): Query<WakeQuery>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !user.is_operator() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden" })),
        )
            .into_response();
    }
    let ip = audit_ip(&headers, addr);
    if let Err(retry_secs) = s.wol_throttle_check(id) {
        db::insert_audit_log_traced(
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
        db::insert_audit_log_traced(
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
    db::insert_audit_log_traced(
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
