//! Small helpers shared across `api` submodules.

use std::net::SocketAddr;

use axum::http::HeaderMap;
use axum::response::Response;

use crate::auth;

pub(crate) fn audit_ip(headers: &HeaderMap, connect: SocketAddr) -> Option<String> {
    auth::client_ip_for_audit(headers, Some(connect))
}

pub(crate) fn err500(e: anyhow::Error) -> Response {
    crate::error::internal_error(e)
}
