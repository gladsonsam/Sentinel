//! Live screen: single JPEG, MJPEG stream, forced update.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::Extension;
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use futures_util::StreamExt;
use uuid::Uuid;

use crate::{auth, db, state::AppState};

use super::helpers::audit_ip;

pub async fn agent_update_now(
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

    let payload = serde_json::json!({ "type": "update_now" }).to_string();
    let tx = s.agent_cmds.lock().get(&id).cloned();
    let Some(tx) = tx else {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Agent is not connected" })),
        )
            .into_response();
    };
    if tx.try_send(payload).is_err() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "Agent command queue is full; retry shortly" })),
        )
            .into_response();
    }

    db::insert_audit_log_traced(
        &s.db,
        user.username.as_str(),
        Some(id),
        "agent_update_now",
        "ok",
        &serde_json::json!({}),
        ip.as_deref(),
    )
    .await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// Serve the most-recent JPEG screenshot as a single image.
pub async fn agent_screen(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let frame = s.frames.lock().get(&id).cloned();
    match frame {
        Some(f) => (
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::CACHE_CONTROL, "no-cache, no-store"),
            ],
            f.jpeg,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "No frame available yet").into_response(),
    }
}

/// `multipart/x-mixed-replace` MJPEG; polls cached frames every 200ms. Viewer refcount
/// drives `start_capture` / `stop_capture` on the agent (guard dropped when HTTP ends).
pub async fn agent_mjpeg(
    Path(id): Path<Uuid>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_operator() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    const BOUNDARY: &str = "mjpegframe";

    let first_viewer = {
        let mut counts = s.capture_viewers.lock();
        let count = counts.entry(id).or_insert(0);
        *count += 1;
        *count == 1
    };

    if first_viewer {
        if let Some(tx) = s.agent_cmds.lock().get(&id) {
            let _ = tx.try_send(r#"{"type":"start_capture"}"#.to_string());
        }
    }

    let guard = CaptureGuard {
        agent_id: id,
        state: s.clone(),
    };

    let stream_state = s.clone();
    let stream = async_stream::stream! {
        // Moving the guard into the stream keeps it alive until the HTTP
        // connection drops, at which point Drop sends stop_capture.
        let _guard = guard;

        let mut interval = tokio::time::interval(Duration::from_millis(200));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_seq: u64 = 0;
        // Track whether the agent was reachable on the previous tick so we can
        // re-issue start_capture the moment it comes back online (the agent
        // always stops capture when its WebSocket session ends, so it needs a
        // fresh start_capture even if the MJPEG HTTP connection never dropped).
        let mut agent_was_online = false;

        loop {
            interval.tick().await;

            let agent_online = stream_state.agents.lock().contains_key(&id);

            // Agent just (re)connected while we're still watching â€” send a
            // fresh start_capture so frames start flowing again.
            if agent_online && !agent_was_online {
                if let Some(tx) = stream_state.agent_cmds.lock().get(&id) {
                    let _ = tx.try_send(r#"{"type":"start_capture"}"#.to_string());
                }
            }
            agent_was_online = agent_online;

            let frame = stream_state.frames.lock().get(&id).cloned();

            let Some(f) = frame else {
                // Agent not connected yet â€” keep the connection alive.
                continue;
            };

            // Skip frames we've already sent.
            if f.seq == last_seq {
                continue;
            }
            last_seq = f.seq;

            let header = format!(
                "--{BOUNDARY}\r\n\
                 Content-Type: image/jpeg\r\n\
                 Content-Length: {}\r\n\
                 \r\n",
                f.jpeg.len()
            );

            let mut part: Vec<u8> = header.into_bytes();
            part.extend_from_slice(&f.jpeg);
            part.extend_from_slice(b"\r\n");

            yield Bytes::from(part);
        }
    };

    let result_stream = stream.map(|b| -> Result<Bytes, Infallible> { Ok(b) });

    Response::builder()
        .status(200)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/x-mixed-replace; boundary={BOUNDARY}"),
        )
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header("Connection", "keep-alive")
        .body(Body::from_stream(result_stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// --- CaptureGuard (MJPEG refcount)

/// Decrements the MJPEG viewer count for `agent_id` when dropped.
/// If the count reaches zero, sends `{"type":"stop_capture"}` to the agent.
struct CaptureGuard {
    agent_id: Uuid,
    state: Arc<AppState>,
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        let should_stop = {
            let mut counts = self.state.capture_viewers.lock();
            if let Some(count) = counts.get_mut(&self.agent_id) {
                *count = count.saturating_sub(1);
                *count == 0
            } else {
                false
            }
        };

        if should_stop {
            if let Some(tx) = self.state.agent_cmds.lock().get(&self.agent_id) {
                let _ = tx.try_send(r#"{"type":"stop_capture"}"#.to_string());
            }
        }
    }
}

