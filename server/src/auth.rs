//! HTTP authentication for the dashboard UI.
//!
//! Multi-user dashboard authentication (DB-backed users + sessions).
//!
//! ## Session lifecycle
//!
//! 1. `POST /api/login` with `{"username":"…","password":"…"}` → server validates
//!    and stores only a SHA-256 hash of a random token in Postgres, then sets
//!    an `HttpOnly` cookie `session=<token>`.
//! 2. Every protected request checks the cookie token hash against the DB and
//!    injects the current user into request extensions.
//! 3. `POST /api/logout` deletes the DB session and clears the cookie.

use std::sync::Arc;
use std::time::{Duration, Instant};

use std::net::SocketAddr;

use anyhow::anyhow;
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tracing::{info, warn};

use crate::db;
use crate::state::AppState;

/// Stored in `audit_log.actor` for dashboard authentication events (login, logout, lockouts).
const AUTH_AUDIT_ACTOR: &str = "auth";

/// Drop failures older than this; max failures within the window triggers 429 on `/api/login`.
const LOGIN_FAIL_WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_LOGIN_FAILURES_PER_WINDOW: usize = 10;

// ─── Middleware ───────────────────────────────────────────────────────────────

/// Axum middleware: rejects requests without a valid session cookie.
/// Passes through unconditionally when no `UI_PASSWORD` is configured.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    // Optional insecure mode: allow requests through when there are no users yet.
    // (Normal deployments should bootstrap an admin user via ADMIN_PASSWORD/UI_PASSWORD.)
    if state.allow_insecure_dashboard_open {
        if let Ok(n) = db::dashboard_user_count(&state.db).await {
            if n == 0 {
                return next.run(req).await;
            }
        }
    }

    let mut req = req;
    let extracted_session = extract_session(req.headers());
    let Some(token) = extracted_session else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )
            .into_response();
    };

    let token_hash = db::sha256_hex_bytes(token.as_bytes());
    let user = match db::dashboard_session_get_user(&state.db, &token_hash).await {
        Ok(Some((user_id, username, role))) => AuthUser { user_id, username, role },
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
                .into_response()
        }
        Err(_) => {
            return crate::error::internal_error(anyhow!("Session store unavailable"));
        }
    };

    // Best-effort session activity touch.
    let _ = db::dashboard_session_touch(&state.db, &token_hash).await;

    req.extensions_mut().insert(user);
    next.run(req).await
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

fn login_client_key(headers: &HeaderMap, addr: SocketAddr) -> String {
    client_ip_for_audit(headers, Some(addr)).unwrap_or_else(|| addr.to_string())
}

fn login_rate_retry_after(state: &AppState, key: &str) -> Option<u64> {
    let mut map = state.login_failures.lock().unwrap();
    let v = map.get_mut(key)?;
    let now = Instant::now();
    v.retain(|t| now.saturating_duration_since(*t) < LOGIN_FAIL_WINDOW);
    if v.is_empty() {
        map.remove(key);
        return None;
    }
    if v.len() >= MAX_LOGIN_FAILURES_PER_WINDOW {
        let oldest = *v.iter().min()?;
        Some(
            (LOGIN_FAIL_WINDOW - now.saturating_duration_since(oldest))
                .as_secs()
                .max(1),
        )
    } else {
        None
    }
}

/// Records a failed login. Returns `Ok(attempts_remaining)` (wrong tries left before lockout), or
/// `Err(retry_secs)` when this attempt triggered the limit.
fn record_login_failure(state: &AppState, key: &str) -> Result<u64, u64> {
    let mut map = state.login_failures.lock().unwrap();
    let v = map.entry(key.to_string()).or_insert_with(Vec::new);
    let now = Instant::now();
    v.retain(|t| now.saturating_duration_since(*t) < LOGIN_FAIL_WINDOW);
    v.push(now);
    if v.len() >= MAX_LOGIN_FAILURES_PER_WINDOW {
        let oldest = *v.iter().min().unwrap();
        Err((LOGIN_FAIL_WINDOW - now.saturating_duration_since(oldest))
            .as_secs()
            .max(1))
    } else {
        let remaining = MAX_LOGIN_FAILURES_PER_WINDOW - v.len();
        Ok(remaining as u64)
    }
}

fn clear_login_failures(state: &AppState, key: &str) {
    if let Ok(mut map) = state.login_failures.lock() {
        map.remove(key);
    }
}

async fn audit_auth_event(
    state: &AppState,
    action: &str,
    status: &str,
    detail: serde_json::Value,
    client_ip: Option<&str>,
) {
    if let Err(e) = db::insert_audit_log(
        &state.db,
        AUTH_AUDIT_ACTOR,
        None,
        action,
        status,
        &detail,
        client_ip,
    )
    .await
    {
        tracing::warn!(error = %e, action, "failed to write auth audit row");
    }
}

fn too_many_login_attempts_response(retry_secs: u64) -> Response {
    warn!(retry_secs, "login rate limited");
    let mut res = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": "Too many login attempts. Try again later.",
            "attempts_remaining": 0u64,
            "max_attempts_per_window": MAX_LOGIN_FAILURES_PER_WINDOW,
            "retry_after_secs": retry_secs,
        })),
    )
        .into_response();
    if let Ok(hv) = HeaderValue::from_str(&retry_secs.to_string()) {
        res.headers_mut().insert(header::RETRY_AFTER, hv);
    }
    res
}

/// `POST /api/login` — validate password and issue a session cookie.
pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LoginRequest>,
) -> Response {
    let client_ip = client_ip_for_audit(&headers, Some(addr));
    let ip_ref = client_ip.as_deref();

    let key = login_client_key(&headers, addr);
    if let Some(retry) = login_rate_retry_after(&state, &key) {
        audit_auth_event(
            &state,
            "login_rate_limited",
            "rejected",
            serde_json::json!({
                "retry_after_secs": retry,
                "reason": "too_many_failures_in_window",
            }),
            ip_ref,
        )
        .await;
        return too_many_login_attempts_response(retry);
    }

    let user_row = match db::dashboard_user_get_by_username(&state.db, body.username.trim()).await {
        Ok(v) => v,
        Err(e) => return crate::error::internal_error(e),
    };
    let Some((user_id, password_hash, _role)) = user_row else {
        // Avoid disclosing whether a username exists.
        return match record_login_failure(&state, &key) {
            Err(retry) => {
                audit_auth_event(
                    &state,
                    "login_rate_limited",
                    "rejected",
                    serde_json::json!({
                        "retry_after_secs": retry,
                        "reason": "wrong_password_threshold",
                    }),
                    ip_ref,
                )
                .await;
                too_many_login_attempts_response(retry)
            }
            Ok(attempts_remaining) => {
                audit_auth_event(
                    &state,
                    "login_failed",
                    "error",
                    serde_json::json!({
                        "attempts_remaining": attempts_remaining,
                        "max_attempts_per_window": MAX_LOGIN_FAILURES_PER_WINDOW,
                    }),
                    ip_ref,
                )
                .await;
                (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "error": "Invalid credentials",
                        "attempts_remaining": attempts_remaining,
                        "max_attempts_per_window": MAX_LOGIN_FAILURES_PER_WINDOW,
                    })),
                )
                    .into_response()
            }
        };
    };

    if !db::verify_dashboard_password(&password_hash, &body.password) {
        match record_login_failure(&state, &key) {
            Err(retry) => {
                audit_auth_event(
                    &state,
                    "login_rate_limited",
                    "rejected",
                    serde_json::json!({
                        "retry_after_secs": retry,
                        "reason": "wrong_password_threshold",
                    }),
                    ip_ref,
                )
                .await;
                return too_many_login_attempts_response(retry);
            }
            Ok(attempts_remaining) => {
                audit_auth_event(
                    &state,
                    "login_failed",
                    "error",
                    serde_json::json!({
                        "attempts_remaining": attempts_remaining,
                        "max_attempts_per_window": MAX_LOGIN_FAILURES_PER_WINDOW,
                    }),
                    ip_ref,
                )
                .await;
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "error": "Invalid credentials",
                        "attempts_remaining": attempts_remaining,
                        "max_attempts_per_window": MAX_LOGIN_FAILURES_PER_WINDOW,
                    })),
                )
                    .into_response();
            }
        }
    }

    clear_login_failures(&state, &key);

    // New random session token; store only its hash in the DB.
    let token = uuid::Uuid::new_v4().to_string();
    let token_hash = db::sha256_hex_bytes(token.as_bytes());
    let expires_at = chrono::Utc::now() + chrono::Duration::days(1);
    if let Err(e) = db::dashboard_session_create(&state.db, &token_hash, user_id, expires_at, ip_ref).await {
        return crate::error::internal_error(e);
    }

    info!("New dashboard session created.");
    audit_auth_event(
        &state,
        "login_success",
        "ok",
        serde_json::json!({ "username": body.username.trim() }),
        ip_ref,
    )
    .await;

    // Auto-detect HTTPS from Traefik's X-Forwarded-Proto header, or fall back
    // to the COOKIE_SECURE env var. This ensures the Secure cookie attribute
    // is set automatically when running behind a TLS-terminating reverse proxy.
    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let secure = forwarded_proto == "https"
        || std::env::var("COOKIE_SECURE")
            .ok()
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);

    // Use SameSite=None when Secure is set so the cookie is sent on
    // non-top-level requests (including WebSocket upgrades) in more
    // deployment/proxy scenarios.
    let cookie = if secure {
        format!(
            "session={}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400",
            token,
        )
    } else {
        format!(
            "session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400",
            token,
        )
    };

    (
        [(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap())],
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

/// `POST /api/logout` — revoke the current session cookie.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let client_ip = client_ip_for_audit(&headers, Some(addr));
    let ip_ref = client_ip.as_deref();

    if let Some(t) = extract_session(&headers) {
        let token_hash = db::sha256_hex_bytes(t.as_bytes());
        let _ = db::dashboard_session_delete(&state.db, &token_hash).await;
        info!("Dashboard session revoked.");
        audit_auth_event(
            &state,
            "logout",
            "ok",
            serde_json::json!({}),
            ip_ref,
        )
        .await;
    }

    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let secure = forwarded_proto == "https"
        || std::env::var("COOKIE_SECURE")
            .ok()
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);

    let clear = if secure {
        "session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"
    } else {
        "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    };
    (
        [(header::SET_COOKIE, HeaderValue::from_static(clear))],
        StatusCode::OK,
    )
        .into_response()
}

/// `GET /api/auth/status` — let the SPA check whether it is already authenticated.
pub async fn status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if state.allow_insecure_dashboard_open {
        if let Ok(n) = db::dashboard_user_count(&state.db).await {
            if n == 0 {
                return Json(serde_json::json!({
                    "authenticated":     true,
                    "password_required": false,
                }))
                .into_response();
            }
        }
    }

    let authenticated = match extract_session(&headers) {
        Some(t) => {
            let token_hash = db::sha256_hex_bytes(t.as_bytes());
            db::dashboard_session_get_user(&state.db, &token_hash)
                .await
                .ok()
                .flatten()
                .is_some()
        }
        None => false,
    };

    let status_code = if authenticated {
        StatusCode::OK
    } else {
        StatusCode::UNAUTHORIZED
    };

    (
        status_code,
        Json(serde_json::json!({
            "authenticated":     authenticated,
            "password_required": true,
        })),
    )
        .into_response()
}

// ─── Request extensions ──────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: uuid::Uuid,
    pub username: String,
    pub role: String, // 'admin' | 'operator' | 'viewer'
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
    pub fn is_operator(&self) -> bool {
        self.role == "operator" || self.role == "admin"
    }
}

// ─── Cookie helper ────────────────────────────────────────────────────────────

/// Best-effort client IP for audit logging (HTTP). Prefer `X-Forwarded-For` first hop,
/// then `X-Real-IP`, then the direct TCP peer when `connect` is provided.
pub fn client_ip_for_audit(headers: &HeaderMap, connect: Option<SocketAddr>) -> Option<String> {
    if let Some(ff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = ff.split(',').next() {
            let t = first.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    if let Some(x) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let t = x.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    connect.map(|a| a.ip().to_string())
}

fn extract_session(headers: &HeaderMap) -> Option<String> {
    let cookie_str = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_str.split(';') {
        if let Some(val) = part.trim().strip_prefix("session=") {
            return Some(val.to_string());
        }
    }
    None
}
