//! Sentinel server: Axum HTTP API, static dashboard, WebSockets for agents and viewers, PostgreSQL.
//!
//! Configuration is via environment variables; see `env.example` in the repository root.

mod alert_rules;
mod api;
mod auth;
mod db;
mod error;
mod oidc;
mod oidc_http;
mod state;
mod wol;
mod ws_agent;
mod ws_viewer;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::Request,
    extract::State,
    http::StatusCode,
    middleware::from_fn_with_state,
    routing::{get, post},
    Router,
};
use axum::http::header::{self, HeaderValue};
use axum::http::{HeaderName, Method};
use axum::middleware::Next;
use axum::response::Response;
use axum::response::IntoResponse;
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}};
use std::io::{stderr, IsTerminal};

use tracing::info;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let ansi = std::env::var("NO_COLOR").is_err()
        && (stderr().is_terminal()
            || std::env::var("LOG_FORCE_COLOR")
                .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
                .unwrap_or(false));
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .compact()
        .with_ansi(ansi)
        .init();

    let db_url = read_env_or_file("DATABASE_URL")
        .unwrap_or_else(|| "postgres://monitor:monitor@localhost:5432/monitor".into());

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .connect(&db_url)
        .await
        .map_err(|e| anyhow::anyhow!("Database connection failed: {e}"))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| anyhow::anyhow!("Migration failed: {e}"))?;

    info!("Database ready.");

    // ── Dashboard users bootstrap ────────────────────────────────────────────
    let allow_insecure_dashboard_open = read_env_or_file("ALLOW_INSECURE_DASHBOARD_OPEN")
        .map(|v| parse_bool(&v))
        .unwrap_or(false);

    let admin_username = read_env_or_file("ADMIN_USERNAME")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "admin".to_string());

    // Backward compatible: UI_PASSWORD becomes the default admin password.
    let admin_password = read_env_or_file("ADMIN_PASSWORD")
        .or_else(|| read_env_or_file("UI_PASSWORD"))
        .filter(|s| !s.is_empty());

    let users = db::dashboard_user_count(&pool).await.unwrap_or(0);
    if users == 0 {
        match admin_password {
            Some(ref pw) => {
                db::bootstrap_default_admin(&pool, &admin_username, pw).await?;
                info!("Bootstrapped default dashboard user '{admin_username}' (role: admin).");
            }
            None => {
                if allow_insecure_dashboard_open {
                    info!("No dashboard users exist yet; dashboard is open (ALLOW_INSECURE_DASHBOARD_OPEN=true).");
                } else {
                    return Err(anyhow::anyhow!(
                        "No dashboard users exist. Set ADMIN_PASSWORD (or UI_PASSWORD) to bootstrap the default admin."
                    ));
                }
            }
        }
    }

    let pool_retention = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = db::prune_telemetry_by_retention(&pool_retention).await {
            tracing::warn!(error = %e, "initial retention prune failed");
        }
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(e) = db::prune_telemetry_by_retention(&pool_retention).await {
                tracing::warn!(error = %e, "retention prune failed");
            }
        }
    });

    if allow_insecure_dashboard_open {
        info!("Dashboard can run without users (insecure opt-in).");
    }

    let agent_secret = read_env_or_file("AGENT_SECRET").filter(|s| !s.is_empty());
    let allow_insecure_agent_auth = read_env_or_file("ALLOW_INSECURE_AGENT_AUTH")
        .map(|v| parse_bool(&v))
        .unwrap_or(false);
    if agent_secret.is_some() {
        info!("Agent authentication enabled (AGENT_SECRET set).");
    } else {
        if allow_insecure_agent_auth {
            info!("Agent authentication disabled (insecure opt-in).");
        } else {
            info!("Agent authentication disabled (deny agent connections; set AGENT_SECRET).");
        }
    }

    let wol_min_interval_secs: u64 = std::env::var("WOL_MIN_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15);
    let wol_min_interval = std::time::Duration::from_secs(wol_min_interval_secs);
    if !wol_min_interval.is_zero() {
        info!("Wake-on-LAN per-agent throttle: {}s.", wol_min_interval_secs);
    }

    let allow_remote_script = read_env_or_file("ALLOW_REMOTE_SCRIPT_EXECUTION")
        .map(|v| parse_bool(&v))
        .unwrap_or(false);
    if allow_remote_script {
        info!("Remote script execution from the dashboard is ENABLED (ALLOW_REMOTE_SCRIPT_EXECUTION).");
    }

    let state = Arc::new(state::AppState::new(
        pool,
        allow_insecure_dashboard_open,
        agent_secret,
        allow_insecure_agent_auth,
        wol_min_interval,
        allow_remote_script,
    ));

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "./static".into());

    let health_routes = Router::new().route("/healthz", get(|| async { (StatusCode::OK, "ok") }));

    let auth_routes = Router::new()
        .route("/api/login", post(auth::login))
        .route("/api/logout", post(auth::logout))
        .route("/api/auth/status", get(auth::status))
        .route("/api/auth/config", get(auth::config))
        .route("/api/auth/oidc/login", get(auth::oidc_login))
        .route("/api/auth/oidc/callback", get(auth::oidc_callback));

    let protected = Router::new()
        .route("/ws/view", get(ws_viewer::handler))
        .nest("/api", api::router())
        .route_layer(from_fn_with_state(state.clone(), auth::require_auth));

    let app = Router::new()
        .route("/ws/agent", get(ws_agent::handler))
        .merge(health_routes)
        .merge(auth_routes)
        .merge(protected)
        // SPA routing: serve `index.html` for unknown paths so reload/back/forward work.
        .fallback_service(
            ServeDir::new(&static_dir)
                .append_index_html_on_directories(true)
                .not_found_service(ServeFile::new(format!("{static_dir}/index.html"))),
        )
        .layer(cors_layer_from_env())
        .layer(from_fn_with_state(
            https_enforced(),
            require_https,
        ))
        .with_state(state);

    let addr = std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:9000".into());
    info!("Listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

fn https_enforced() -> bool {
    std::env::var("ENFORCE_HTTPS")
        .ok()
        .map(|v| parse_bool(&v))
        .unwrap_or(true)
}

async fn require_https(
    State(enforce): State<bool>,
    req: Request,
    next: Next,
) -> Response {
    if !enforce {
        return next.run(req).await;
    }

    // Allow health checks without HTTPS enforcement.
    if req.uri().path() == "/healthz" {
        return next.run(req).await;
    }

    let forwarded_proto = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Some reverse proxies set X-Forwarded-Proto to `wss` for WebSocket
    // upgrades. Treat it as valid because it still means TLS.
    if forwarded_proto.eq_ignore_ascii_case("https")
        || forwarded_proto.eq_ignore_ascii_case("wss")
    {
        next.run(req).await
    } else {
        (
            StatusCode::UPGRADE_REQUIRED,
            "HTTPS required (set ENFORCE_HTTPS=false for local HTTP testing).",
        )
            .into_response()
    }
}

fn cors_layer_from_env() -> CorsLayer {
    let raw = std::env::var("CORS_ORIGINS").unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        // Dev/default behavior: don't actively constrain CORS.
        return CorsLayer::permissive();
    }

    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<HeaderValue>().ok())
        .collect();

    if origins.is_empty() {
        return CorsLayer::permissive();
    }

    // Since the dashboard uses cookie auth, we must allow credentials when
    // cross-origin requests are expected.
    CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static("x-csrf-token"),
        ])
}

/// Read config either from `NAME` or `NAME_FILE` (Docker secrets pattern).
fn read_env_or_file(name: &str) -> Option<String> {
    if let Ok(val) = std::env::var(name) {
        return Some(val);
    }
    let file_key = format!("{name}_FILE");
    let path = std::env::var(file_key).ok()?;
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
}

fn parse_bool(s: &str) -> bool {
    matches!(
        s.trim(),
        "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
    )
}
