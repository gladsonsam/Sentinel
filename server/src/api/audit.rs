//! Audit log query API.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::Extension;
use axum::{
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

use crate::{auth, db, state::AppState};

use super::helpers::{audit_ip, err500};

use super::pagination::{validate_audit_params, AuditParams};
pub async fn audit_log(
    Query(p): Query<AuditParams>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if let Err(msg) = validate_audit_params(&p) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
            .into_response();
    }

    let ip = audit_ip(&headers, addr);
    match db::query_audit_log(
        &s.db,
        p.agent_id,
        p.action.as_deref(),
        p.status.as_deref(),
        p.limit,
        p.offset,
    )
    .await
    {
        Ok(rows) => {
            let detail = serde_json::json!({
                "action_filter": p.action,
                "status_filter": p.status,
                "limit": p.limit,
                "offset": p.offset
            });
            db::insert_audit_log_dedup_traced(
                &s.db,
                db::AuditLogDedup {
                    actor: user.username.as_str(),
                    agent_id: p.agent_id,
                    action: "view_audit_log",
                    status: "ok",
                    detail: &detail,
                    dedup_window_secs: 10,
                    client_ip: ip.as_deref(),
                },
            )
            .await;
            Json(serde_json::json!({ "rows": rows })).into_response()
        }
        Err(e) => err500(e),
    }
}
