//! Database operations.
//!
//! All queries use the non-macro `sqlx::query()` / `sqlx::query_scalar()` API
//! so the server compiles without a running database (no `SQLX_OFFLINE` flag
//! needed in CI or Docker builds).

use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use serde::Serialize;
use std::ops::DerefMut;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::rngs::OsRng;

/// Mirrors each persisted audit row to `tracing` so `docker logs` matches the dashboard log.
fn emit_audit_tracing_line(actor: &str, action: &str, status: &str, client_ip: Option<&str>) {
    let ip = client_ip.unwrap_or("-");
    match status {
        "error" => tracing::error!(
            target: "sentinel_audit",
            actor,
            action,
            status,
            ip,
            "audit"
        ),
        "rejected" => tracing::warn!(
            target: "sentinel_audit",
            actor,
            action,
            status,
            ip,
            "audit"
        ),
        _ => tracing::info!(
            target: "sentinel_audit",
            actor,
            action,
            status,
            ip,
            "audit"
        ),
    }
}

// ─── Retention policy ─────────────────────────────────────────────────────────

/// Global retention: `None` / NULL = keep forever (no automatic deletion).
#[derive(Debug, Clone, Serialize)]
pub struct RetentionPolicy {
    pub keylog_days: Option<i32>,
    pub window_days: Option<i32>,
    pub url_days: Option<i32>,
}

/// Per-agent override. Each `None` means “use global default for that category”.
#[derive(Debug, Clone, Serialize)]
pub struct RetentionAgentOverride {
    pub keylog_days: Option<i32>,
    pub window_days: Option<i32>,
    pub url_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub id: i64,
    pub ts: DateTime<Utc>,
    pub actor: String,
    /// Set on HTTP audit rows; null for older rows or WebSocket-only events.
    pub client_ip: Option<String>,
    pub agent_id: Option<Uuid>,
    pub action: String,
    pub status: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct UrlTopRow {
    pub url: String,
    pub visit_count: i64,
    pub last_ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowTopRow {
    pub app: String,
    pub app_display: String,
    pub title: String,
    pub focus_count: i64,
    pub last_ts: DateTime<Utc>,
}

// ─── Dashboard users & sessions ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DashboardUserRow {
    pub id: Uuid,
    pub username: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

pub fn sha256_hex_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

pub fn hash_dashboard_password(plain: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(plain.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash failed: {e}"))?
        .to_string();
    Ok(hash)
}

pub fn verify_dashboard_password(hash: &str, plain: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok()
}

pub async fn dashboard_user_count(pool: &PgPool) -> Result<i64> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_users")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

pub async fn dashboard_admin_count(pool: &PgPool) -> Result<i64> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_users WHERE role = 'admin'")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

pub async fn dashboard_user_is_admin(pool: &PgPool, user_id: Uuid) -> Result<bool> {
    let v: Option<String> = sqlx::query_scalar("SELECT role FROM dashboard_users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .flatten();
    Ok(v.as_deref() == Some("admin"))
}

pub async fn dashboard_user_get_by_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<(Uuid, String, String)>> {
    // Returns (id, password_hash, role)
    let row = sqlx::query(
        "SELECT id, password_hash, role FROM dashboard_users WHERE lower(username) = lower($1)",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        (
            r.try_get::<Uuid, _>("id").unwrap_or_default(),
            r.try_get::<String, _>("password_hash")
                .unwrap_or_else(|_| "".to_string()),
            r.try_get::<String, _>("role")
                .unwrap_or_else(|_| "viewer".to_string()),
        )
    }))
}

pub async fn dashboard_user_list(pool: &PgPool) -> Result<Vec<DashboardUserRow>> {
    let rows = sqlx::query("SELECT id, username, role, created_at FROM dashboard_users ORDER BY lower(username) ASC")
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .map(|r| DashboardUserRow {
            id: r.try_get("id").unwrap_or_default(),
            username: r.try_get("username").unwrap_or_else(|_| "".to_string()),
            role: r.try_get("role").unwrap_or_else(|_| "viewer".to_string()),
            created_at: r
                .try_get("created_at")
                .unwrap_or_else(|_| Utc::now()),
        })
        .collect())
}

pub async fn dashboard_user_create(
    pool: &PgPool,
    username: &str,
    password_plain: &str,
    role: &str,
) -> Result<Uuid> {
    let hash = hash_dashboard_password(password_plain)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO dashboard_users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(username)
    .bind(hash)
    .bind(role)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn dashboard_user_set_password(pool: &PgPool, user_id: Uuid, password_plain: &str) -> Result<()> {
    let hash = hash_dashboard_password(password_plain)?;
    sqlx::query("UPDATE dashboard_users SET password_hash = $2 WHERE id = $1")
        .bind(user_id)
        .bind(hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_user_set_role(pool: &PgPool, user_id: Uuid, role: &str) -> Result<()> {
    sqlx::query("UPDATE dashboard_users SET role = $2 WHERE id = $1")
        .bind(user_id)
        .bind(role)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_user_delete(pool: &PgPool, user_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM dashboard_users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_session_create(
    pool: &PgPool,
    token_sha256_hex: &str,
    user_id: Uuid,
    expires_at: DateTime<Utc>,
    client_ip: Option<&str>,
    csrf_token: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO dashboard_sessions (token_sha256_hex, user_id, expires_at, client_ip, csrf_token) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(token_sha256_hex)
    .bind(user_id)
    .bind(expires_at)
    .bind(client_ip)
    .bind(csrf_token)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn dashboard_session_delete(pool: &PgPool, token_sha256_hex: &str) -> Result<()> {
    sqlx::query("DELETE FROM dashboard_sessions WHERE token_sha256_hex = $1")
        .bind(token_sha256_hex)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_session_touch(pool: &PgPool, token_sha256_hex: &str) -> Result<()> {
    sqlx::query("UPDATE dashboard_sessions SET last_seen_at = NOW() WHERE token_sha256_hex = $1")
        .bind(token_sha256_hex)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_session_get_user(
    pool: &PgPool,
    token_sha256_hex: &str,
) -> Result<Option<(Uuid, String, String, String)>> {
    // Returns (user_id, username, role, csrf_token) when session exists and is not expired.
    let row = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.role, s.csrf_token
        FROM dashboard_sessions s
        JOIN dashboard_users u ON u.id = s.user_id
        WHERE s.token_sha256_hex = $1
          AND s.expires_at > NOW()
        "#,
    )
    .bind(token_sha256_hex)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        (
            r.try_get::<Uuid, _>("user_id").unwrap_or_default(),
            r.try_get::<String, _>("username")
                .unwrap_or_else(|_| "".to_string()),
            r.try_get::<String, _>("role")
                .unwrap_or_else(|_| "viewer".to_string()),
            r.try_get::<String, _>("csrf_token")
                .unwrap_or_else(|_| "".to_string()),
        )
    }))
}

pub async fn bootstrap_default_admin(pool: &PgPool, username: &str, password_plain: &str) -> Result<()> {
    if dashboard_user_count(pool).await? > 0 {
        return Ok(());
    }
    // First boot: create the initial admin user.
    let _ = dashboard_user_create(pool, username, password_plain, "admin").await?;
    Ok(())
}

pub async fn dashboard_identity_get_user_id(
    pool: &PgPool,
    issuer: &str,
    subject: &str,
) -> Result<Option<Uuid>> {
    let v: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM dashboard_identities WHERE issuer = $1 AND subject = $2",
    )
    .bind(issuer)
    .bind(subject)
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(v)
}

pub async fn dashboard_identity_upsert(
    pool: &PgPool,
    issuer: &str,
    subject: &str,
    user_id: Uuid,
    preferred_username: Option<&str>,
    email: Option<&str>,
    name: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO dashboard_identities (issuer, subject, user_id, preferred_username, email, name, last_login_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (issuer, subject) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            preferred_username = EXCLUDED.preferred_username,
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            last_login_at = NOW()
        "#,
    )
    .bind(issuer)
    .bind(subject)
    .bind(user_id)
    .bind(preferred_username)
    .bind(email)
    .bind(name)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardIdentityRow {
    pub id: i64,
    pub issuer: String,
    pub subject: String,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub last_login_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

pub async fn dashboard_identities_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<DashboardIdentityRow>> {
    let rows = sqlx::query(
        r#"
        SELECT id, issuer, subject, preferred_username, email, name, last_login_at, created_at
        FROM dashboard_identities
        WHERE user_id = $1
        ORDER BY last_login_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| DashboardIdentityRow {
            id: r.try_get("id").unwrap_or_default(),
            issuer: r.try_get("issuer").unwrap_or_else(|_| "".to_string()),
            subject: r.try_get("subject").unwrap_or_else(|_| "".to_string()),
            preferred_username: r.try_get("preferred_username").ok().flatten(),
            email: r.try_get("email").ok().flatten(),
            name: r.try_get("name").ok().flatten(),
            last_login_at: r.try_get("last_login_at").unwrap_or_else(|_| Utc::now()),
            created_at: r.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        })
        .collect())
}

pub async fn dashboard_identity_unlink(pool: &PgPool, identity_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM dashboard_identities WHERE id = $1")
        .bind(identity_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn dashboard_identity_link(
    pool: &PgPool,
    issuer: &str,
    subject: &str,
    user_id: Uuid,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO dashboard_identities (issuer, subject, user_id, last_login_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (issuer, subject) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            last_login_at = NOW()
        "#,
    )
    .bind(issuer)
    .bind(subject)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/// Insert the agent if it doesn't exist yet; always bump `last_seen`.
/// Returns the stable UUID for this agent name.
pub async fn upsert_agent(pool: &PgPool, name: &str) -> Result<Uuid> {
    let row = sqlx::query(
        r#"
        INSERT INTO agents (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET last_seen = NOW()
        RETURNING id
        "#,
    )
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

/// Update `last_seen` when the agent disconnects.
pub async fn touch_agent(pool: &PgPool, id: Uuid) -> Result<()> {
    sqlx::query("UPDATE agents SET last_seen = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Upsert the latest system/specs snapshot for an agent.
pub async fn upsert_agent_info(pool: &PgPool, agent_id: Uuid, info: &serde_json::Value) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO agent_info (agent_id, info, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (agent_id)
        DO UPDATE SET info = EXCLUDED.info, updated_at = NOW()
        "#,
    )
    .bind(agent_id)
    .bind(info)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch the latest stored system/specs snapshot for an agent (if any).
pub async fn get_agent_info(pool: &PgPool, agent_id: Uuid) -> Result<Option<serde_json::Value>> {
    let row = sqlx::query("SELECT info FROM agent_info WHERE agent_id = $1")
        .bind(agent_id)
        .fetch_optional(pool)
        .await?;

    Ok(row.and_then(|r| r.try_get::<serde_json::Value, _>("info").ok()))
}

// ─── Agent sessions (connection history) ──────────────────────────────────────

/// Record a new WebSocket session for an agent. Returns the session row id.
pub async fn start_agent_session(pool: &PgPool, agent_id: Uuid) -> Result<i64> {
    let id: i64 =
        sqlx::query_scalar(r#"INSERT INTO agent_sessions (agent_id) VALUES ($1) RETURNING id"#)
            .bind(agent_id)
            .fetch_one(pool)
            .await?;
    Ok(id)
}

/// Mark an agent session disconnected.
pub async fn end_agent_session(pool: &PgPool, session_id: i64) -> Result<()> {
    sqlx::query("UPDATE agent_sessions SET disconnected_at = NOW() WHERE id = $1")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Returns (last_connected_at, last_disconnected_at) for an agent.
pub async fn agent_last_session_times(
    pool: &PgPool,
    agent_id: Uuid,
) -> Result<(Option<DateTime<Utc>>, Option<DateTime<Utc>>)> {
    let row = sqlx::query(
        r#"
        SELECT
            MAX(connected_at)    AS last_connected_at,
            MAX(disconnected_at) AS last_disconnected_at
        FROM agent_sessions
        WHERE agent_id = $1
        "#,
    )
    .bind(agent_id)
    .fetch_one(pool)
    .await?;

    let last_connected_at: Option<DateTime<Utc>> = row.try_get("last_connected_at").ok();
    let last_disconnected_at: Option<DateTime<Utc>> = row.try_get("last_disconnected_at").ok();
    Ok((last_connected_at, last_disconnected_at))
}

// ─── Window events ────────────────────────────────────────────────────────────

pub async fn insert_window(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let title = v["title"].as_str().unwrap_or("");
    let app = v["app"].as_str().unwrap_or("");
    let app_display = v["app_display"].as_str().unwrap_or(app);
    let hwnd = v["hwnd"].as_i64().unwrap_or(0);
    let ts = unix_to_dt(v["ts"].as_i64());

    sqlx::query(
        "INSERT INTO window_events (agent_id, title, app, app_display, hwnd, ts) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(agent)
    .bind(title)
    .bind(app)
    .bind(app_display)
    .bind(hwnd)
    .bind(ts)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO window_top_stats (agent_id, app, app_display, title, focus_count, last_ts)
        VALUES ($1, $2, $3, $4, 1, $5)
        ON CONFLICT (agent_id, app, title) DO UPDATE
        SET app_display = EXCLUDED.app_display,
            focus_count = window_top_stats.focus_count + 1,
            last_ts = GREATEST(window_top_stats.last_ts, EXCLUDED.last_ts)
        "#,
    )
    .bind(agent)
    .bind(app)
    .bind(app_display)
    .bind(title)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── Key sessions ─────────────────────────────────────────────────────────────

/// Append text to an open session (same agent/app/window, updated ≤ 30 s ago).
/// Creates a new session row if no open one exists.
pub async fn upsert_keys(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let app = v["app"].as_str().unwrap_or("");
    let app_display = v["app_display"].as_str().unwrap_or(app);
    let window = v["window"].as_str().unwrap_or("");
    let text = v["text"].as_str().unwrap_or("");
    let ts = unix_to_dt(v["ts"].as_i64());

    let updated = sqlx::query(
        r#"
        UPDATE key_sessions
        SET    text         = text || $1,
               app_display  = $2,
               updated_at   = NOW()
        WHERE  agent_id     = $3
          AND  app          = $4
          AND  window_title = $5
          AND  updated_at   > NOW() - INTERVAL '30 seconds'
        "#,
    )
    .bind(text)
    .bind(app_display)
    .bind(agent)
    .bind(app)
    .bind(window)
    .execute(pool)
    .await?;

    if updated.rows_affected() == 0 {
        sqlx::query(
            "INSERT INTO key_sessions (agent_id, app, app_display, window_title, text, started_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,NOW())",
        )
        .bind(agent)
        .bind(app)
        .bind(app_display)
        .bind(window)
        .bind(text)
        .bind(ts)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ─── URL visits ───────────────────────────────────────────────────────────────

/// Insert a URL visit, skipping exact consecutive duplicates for this agent.
pub async fn insert_url(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let url = v["url"].as_str().unwrap_or("");
    let title = v["title"].as_str();
    let browser = v["browser"].as_str();
    let ts = unix_to_dt(v["ts"].as_i64());

    // Skip if same URL as the most-recent visit for this agent.
    let last: Option<String> = sqlx::query_scalar(
        "SELECT url FROM url_visits WHERE agent_id = $1 ORDER BY ts DESC LIMIT 1",
    )
    .bind(agent)
    .fetch_optional(pool)
    .await?;

    if last.as_deref() == Some(url) {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO url_visits (agent_id, url, title, browser, ts) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(agent)
    .bind(url)
    .bind(title)
    .bind(browser)
    .bind(ts)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO url_top_stats (agent_id, url, visit_count, last_ts)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (agent_id, url) DO UPDATE
        SET visit_count = url_top_stats.visit_count + 1,
            last_ts = GREATEST(url_top_stats.last_ts, EXCLUDED.last_ts)
        "#,
    )
    .bind(agent)
    .bind(url)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── Activity log ─────────────────────────────────────────────────────────────

pub async fn insert_activity(pool: &PgPool, agent: Uuid, v: &serde_json::Value) -> Result<()> {
    let kind = v["type"].as_str().unwrap_or("");
    let idle_secs = v["idle_secs"].as_i64();
    let ts = unix_to_dt(v["ts"].as_i64());

    sqlx::query(
        "INSERT INTO activity_log (agent_id, event_type, idle_secs, ts) VALUES ($1,$2,$3,$4)",
    )
    .bind(agent)
    .bind(kind)
    .bind(idle_secs)
    .bind(ts)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── List / query helpers (used by API) ───────────────────────────────────────

pub async fn list_agents(pool: &PgPool) -> Result<Vec<serde_json::Value>> {
    let rows =
        sqlx::query("SELECT id, name, first_seen, last_seen, icon FROM agents ORDER BY last_seen DESC")
            .fetch_all(pool)
            .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let id: Uuid = r.try_get("id").unwrap_or_default();
            let name: String = r.try_get("name").unwrap_or_default();
            let first: DateTime<Utc> = r.try_get("first_seen").unwrap_or_else(|_| Utc::now());
            let last: DateTime<Utc> = r.try_get("last_seen").unwrap_or_else(|_| Utc::now());
            let icon: Option<String> = r.try_get("icon").ok();
            serde_json::json!({ "id": id, "name": name, "first_seen": first, "last_seen": last, "icon": icon })
        })
        .collect())
}

/// Set (or clear) an agent icon label.
pub async fn set_agent_icon(pool: &PgPool, agent_id: Uuid, icon: Option<&str>) -> Result<()> {
    sqlx::query("UPDATE agents SET icon = $2 WHERE id = $1")
        .bind(agent_id)
        .bind(icon)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_agent_icon(pool: &PgPool, agent_id: Uuid) -> Result<Option<String>> {
    let v: Option<String> = sqlx::query_scalar("SELECT icon FROM agents WHERE id = $1")
        .bind(agent_id)
        .fetch_optional(pool)
        .await?
        .flatten();
    Ok(v)
}

pub async fn insert_audit_log(
    pool: &PgPool,
    actor: &str,
    agent_id: Option<Uuid>,
    action: &str,
    status: &str,
    detail: &serde_json::Value,
    client_ip: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_log (actor, agent_id, action, status, detail, client_ip) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(actor)
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(detail)
    .bind(client_ip)
    .execute(pool)
    .await?;

    emit_audit_tracing_line(actor, action, status, client_ip);

    Ok(())
}

/// Insert an audit row unless an identical recent row already exists.
///
/// "Identical" means same actor/agent/action/status/detail JSON and within
/// `dedup_window_secs` from now.
pub async fn insert_audit_log_dedup(
    pool: &PgPool,
    actor: &str,
    agent_id: Option<Uuid>,
    action: &str,
    status: &str,
    detail: &serde_json::Value,
    dedup_window_secs: i64,
    client_ip: Option<&str>,
) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM audit_log
        WHERE actor = $1
          AND (($2::uuid IS NULL AND agent_id IS NULL) OR agent_id = $2)
          AND action = $3
          AND status = $4
          AND detail = $5::jsonb
          AND (client_ip IS NOT DISTINCT FROM $7::text)
          AND ts > NOW() - ($6::bigint * INTERVAL '1 second')
        ORDER BY ts DESC
        LIMIT 1
        "#,
    )
    .bind(actor)
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(detail)
    .bind(dedup_window_secs)
    .bind(client_ip)
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        insert_audit_log(pool, actor, agent_id, action, status, detail, client_ip).await?;
    }

    Ok(())
}

pub async fn query_audit_log(
    pool: &PgPool,
    agent_id: Option<Uuid>,
    action: Option<&str>,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT id, ts, actor, client_ip, agent_id, action, status, detail
        FROM audit_log
        WHERE ($1::uuid IS NULL OR agent_id = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR status = $3)
        ORDER BY ts DESC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(agent_id)
    .bind(action)
    .bind(status)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| AuditRecord {
            id: r.try_get("id").unwrap_or_default(),
            ts: r.try_get("ts").unwrap_or_else(|_| Utc::now()),
            actor: r.try_get("actor").unwrap_or_else(|_| "dashboard".to_string()),
            client_ip: r.try_get("client_ip").ok(),
            agent_id: r.try_get("agent_id").ok(),
            action: r.try_get("action").unwrap_or_default(),
            status: r.try_get("status").unwrap_or_else(|_| "ok".to_string()),
            detail: r
                .try_get("detail")
                .unwrap_or_else(|_| serde_json::json!({})),
        })
        .collect())
}

pub async fn query_top_urls(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<UrlTopRow>> {
    let rows = sqlx::query(
        r#"
        SELECT url, visit_count, last_ts
        FROM url_top_stats
        WHERE agent_id = $1
        ORDER BY visit_count DESC, last_ts DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| UrlTopRow {
            url: r.try_get("url").unwrap_or_default(),
            visit_count: r.try_get("visit_count").unwrap_or_default(),
            last_ts: r.try_get("last_ts").unwrap_or_else(|_| Utc::now()),
        })
        .collect())
}

pub async fn query_top_windows(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<WindowTopRow>> {
    let rows = sqlx::query(
        r#"
        SELECT app, app_display, title, focus_count, last_ts
        FROM window_top_stats
        WHERE agent_id = $1
        ORDER BY focus_count DESC, last_ts DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| WindowTopRow {
            app: r.try_get("app").unwrap_or_default(),
            app_display: r.try_get("app_display").unwrap_or_default(),
            title: r.try_get("title").unwrap_or_default(),
            focus_count: r.try_get("focus_count").unwrap_or_default(),
            last_ts: r.try_get("last_ts").unwrap_or_else(|_| Utc::now()),
        })
        .collect())
}

pub async fn query_database_storage(pool: &PgPool) -> Result<serde_json::Value> {
    let db_size_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let table_rows = sqlx::query(
        r#"
        SELECT
            relname::text AS name,
            pg_total_relation_size(c.oid)::bigint AS bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND relname IN (
            'window_events', 'key_sessions', 'url_visits', 'activity_log',
            'url_top_stats', 'window_top_stats', 'audit_log', 'agent_info'
          )
        ORDER BY bytes DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    let tables = table_rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "bytes": r.try_get::<i64, _>("bytes").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "database_bytes": db_size_bytes,
        "tables": tables
    }))
}

pub async fn query_windows(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT title, app, app_display, hwnd, ts \
         FROM window_events WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let title: String = r.try_get("title").unwrap_or_default();
            let app: String = r.try_get("app").unwrap_or_default();
            let app_display: String = r.try_get("app_display").unwrap_or_default();
            let hwnd: i64 = r.try_get("hwnd").unwrap_or_default();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "title": title, "app": app, "app_display": app_display, "hwnd": hwnd, "ts": ts })
        })
        .collect())
}

pub async fn query_keys(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT app, app_display, window_title, text, started_at, updated_at \
         FROM key_sessions WHERE agent_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let app: String = r.try_get("app").unwrap_or_default();
            let app_display: String = r.try_get("app_display").unwrap_or_default();
            let window: String = r.try_get("window_title").unwrap_or_default();
            let text: String = r.try_get("text").unwrap_or_default();
            let started_at: DateTime<Utc> = r.try_get("started_at").unwrap_or_else(|_| Utc::now());
            let updated_at: DateTime<Utc> = r.try_get("updated_at").unwrap_or_else(|_| Utc::now());
            serde_json::json!({
                "app": app, "app_display": app_display,
                "window_title": window, "text": text,
                "started_at": started_at, "updated_at": updated_at
            })
        })
        .collect())
}

pub async fn query_urls(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT url, title, browser, ts \
         FROM url_visits WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let url: String = r.try_get("url").unwrap_or_default();
            let title: Option<String> = r.try_get("title").ok().flatten();
            let browser: Option<String> = r.try_get("browser").ok().flatten();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "url": url, "title": title, "browser": browser, "ts": ts })
        })
        .collect())
}

pub async fn query_activity(
    pool: &PgPool,
    agent: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT event_type, idle_secs, ts \
         FROM activity_log WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3",
    )
    .bind(agent)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| {
            let event_type: String = r.try_get("event_type").unwrap_or_default();
            let idle_secs: Option<i64> = r.try_get("idle_secs").ok().flatten();
            let ts: DateTime<Utc> = r.try_get("ts").unwrap_or_else(|_| Utc::now());
            serde_json::json!({ "event_type": event_type, "idle_secs": idle_secs, "ts": ts })
        })
        .collect())
}

/// Clear all telemetry history for an agent while keeping the `agents` row.
///
/// This is used by the dashboard "clear history" UX so operators can
/// selectively wipe what they previously recorded for a single client.
pub async fn clear_agent_history(pool: &PgPool, agent: Uuid) -> Result<u64> {
    // Note: we intentionally do NOT delete from `agents` (the sidebar needs it).
    // Deleting telemetry rows keeps foreign keys simple (each table already
    // references `agents(id)` with ON DELETE CASCADE).
    let win = sqlx::query("DELETE FROM window_events WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let keys = sqlx::query("DELETE FROM key_sessions WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let urls = sqlx::query("DELETE FROM url_visits WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    let activity = sqlx::query("DELETE FROM activity_log WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    // Also clear websocket connection history so "last seen" becomes empty.
    // If you prefer to keep last-seen timestamps, remove this query.
    let sessions = sqlx::query("DELETE FROM agent_sessions WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(win.saturating_add(keys).saturating_add(urls).saturating_add(activity).saturating_add(sessions))
}

// ─── Retention settings & pruning ─────────────────────────────────────────────

pub async fn get_retention_global(pool: &PgPool) -> Result<RetentionPolicy> {
    let row = sqlx::query(
        "SELECT keylog_days, window_days, url_days FROM retention_global WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;

    Ok(RetentionPolicy {
        keylog_days: row.try_get::<Option<i32>, _>("keylog_days").unwrap_or(None),
        window_days: row.try_get::<Option<i32>, _>("window_days").unwrap_or(None),
        url_days: row.try_get::<Option<i32>, _>("url_days").unwrap_or(None),
    })
}

pub async fn set_retention_global(pool: &PgPool, p: &RetentionPolicy) -> Result<()> {
    sqlx::query(
        "UPDATE retention_global SET keylog_days = $1, window_days = $2, url_days = $3 WHERE id = 1",
    )
    .bind(p.keylog_days)
    .bind(p.window_days)
    .bind(p.url_days)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_retention_agent(pool: &PgPool, agent: Uuid) -> Result<Option<RetentionAgentOverride>> {
    let row = sqlx::query(
        "SELECT keylog_days, window_days, url_days FROM retention_agent WHERE agent_id = $1",
    )
    .bind(agent)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| RetentionAgentOverride {
        keylog_days: r.try_get::<Option<i32>, _>("keylog_days").unwrap_or(None),
        window_days: r.try_get::<Option<i32>, _>("window_days").unwrap_or(None),
        url_days: r.try_get::<Option<i32>, _>("url_days").unwrap_or(None),
    }))
}

pub async fn set_retention_agent(pool: &PgPool, agent: Uuid, p: &RetentionAgentOverride) -> Result<()> {
    let all_inherit = p.keylog_days.is_none() && p.window_days.is_none() && p.url_days.is_none();
    if all_inherit {
        sqlx::query("DELETE FROM retention_agent WHERE agent_id = $1")
            .bind(agent)
            .execute(pool)
            .await?;
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO retention_agent (agent_id, keylog_days, window_days, url_days)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agent_id) DO UPDATE SET
            keylog_days = EXCLUDED.keylog_days,
            window_days = EXCLUDED.window_days,
            url_days = EXCLUDED.url_days
        "#,
    )
    .bind(agent)
    .bind(p.keylog_days)
    .bind(p.window_days)
    .bind(p.url_days)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_retention_agent(pool: &PgPool, agent: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM retention_agent WHERE agent_id = $1")
        .bind(agent)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete telemetry older than the effective retention for each agent.
/// Activity (AFK) rows use the same cutoff as window history.
pub async fn prune_telemetry_by_retention(pool: &PgPool) -> Result<()> {
    let global = get_retention_global(pool).await?;

    let agent_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM agents").fetch_all(pool).await?;

    for aid in agent_ids {
        let ov = get_retention_agent(pool, aid).await?.unwrap_or(RetentionAgentOverride {
            keylog_days: None,
            window_days: None,
            url_days: None,
        });

        let key_d = ov.keylog_days.or(global.keylog_days);
        let win_d = ov.window_days.or(global.window_days);
        let url_d = ov.url_days.or(global.url_days);

        if let Some(days) = key_d {
            sqlx::query(
                "DELETE FROM key_sessions WHERE agent_id = $1 AND updated_at < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }

        if let Some(days) = win_d {
            sqlx::query(
                "DELETE FROM window_events WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;

            sqlx::query(
                "DELETE FROM activity_log WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }

        if let Some(days) = url_d {
            sqlx::query(
                "DELETE FROM url_visits WHERE agent_id = $1 AND ts < NOW() - ($2::bigint * INTERVAL '1 day')",
            )
            .bind(aid)
            .bind(days as i64)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ─── Agent local UI password (SHA-256 hex, matches Windows agent config.rs) ───

/// SHA-256 hex digest — same algorithm as the agent `hash_password()`.
pub fn sha256_hex(plain: &str) -> String {
    let mut h = Sha256::new();
    h.update(plain.as_bytes());
    format!("{:x}", h.finalize())
}

/// Hash for an empty password (no lock).
pub fn empty_agent_ui_password_hash() -> String {
    sha256_hex("")
}

/// `true` if this hash means the user must type a non-empty password to open settings.
pub fn agent_ui_password_is_set(hash: Option<&str>) -> bool {
    match hash {
        None => false,
        Some(h) if h.is_empty() => false,
        Some(h) => h != empty_agent_ui_password_hash().as_str(),
    }
}

pub async fn get_local_ui_global_hash(pool: &PgPool) -> Result<Option<String>> {
    let v: Option<String> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;
    Ok(v)
}

pub async fn set_local_ui_global_hash(pool: &PgPool, hash: Option<&str>) -> Result<()> {
    sqlx::query(
        "UPDATE agent_local_ui_password SET password_hash_sha256 = $1 WHERE id = 1",
    )
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_local_ui_override_hash(pool: &PgPool, agent_id: Uuid) -> Result<Option<String>> {
    let v: Option<Option<String>> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password_override WHERE agent_id = $1",
    )
    .bind(agent_id)
    .fetch_optional(pool)
    .await?;

    Ok(v.flatten())
}

pub async fn set_local_ui_override_hash(pool: &PgPool, agent_id: Uuid, hash: Option<&str>) -> Result<()> {
    match hash {
        None => {
            sqlx::query("DELETE FROM agent_local_ui_password_override WHERE agent_id = $1")
                .bind(agent_id)
                .execute(pool)
                .await?;
        }
        Some(h) => {
            sqlx::query(
                r#"
                INSERT INTO agent_local_ui_password_override (agent_id, password_hash_sha256)
                VALUES ($1, $2)
                ON CONFLICT (agent_id) DO UPDATE SET
                    password_hash_sha256 = EXCLUDED.password_hash_sha256
                "#,
            )
            .bind(agent_id)
            .bind(h)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

pub async fn clear_local_ui_override(pool: &PgPool, agent_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM agent_local_ui_password_override WHERE agent_id = $1")
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Effective hash pushed to the agent (override wins when set).
pub async fn effective_agent_ui_password_hash(pool: &PgPool, agent_id: Uuid) -> Result<String> {
    let global: Option<String> = sqlx::query_scalar(
        "SELECT password_hash_sha256 FROM agent_local_ui_password WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;

    let global_hex = match global {
        Some(h) if !h.is_empty() => h,
        _ => empty_agent_ui_password_hash(),
    };

    let ov = get_local_ui_override_hash(pool, agent_id).await?;
    if let Some(h) = ov {
        if !h.is_empty() {
            return Ok(h);
        }
    }
    Ok(global_hex)
}

// ─── Installed software inventory ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct AgentSoftwareRow {
    pub name: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub install_location: Option<String>,
    pub install_date: Option<String>,
    pub captured_at: DateTime<Utc>,
}

/// Replace all software rows for an agent with a fresh snapshot (`items` from agent JSON).
pub async fn replace_agent_software(
    pool: &PgPool,
    agent_id: Uuid,
    items: &[serde_json::Value],
) -> Result<usize> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM agent_software WHERE agent_id = $1")
        .bind(agent_id)
        .execute(&mut *tx)
        .await?;

    let mut n = 0usize;
    for item in items.iter().take(12_000) {
        let name = item["name"].as_str().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let version = item["version"].as_str().map(|s| s.to_string());
        let publisher = item["publisher"].as_str().map(|s| s.to_string());
        let install_location = item["install_location"].as_str().map(|s| s.to_string());
        let install_date = item["install_date"].as_str().map(|s| s.to_string());
        sqlx::query(
            r#"
            INSERT INTO agent_software (agent_id, name, version, publisher, install_location, install_date)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(agent_id)
        .bind(name)
        .bind(version.as_deref())
        .bind(publisher.as_deref())
        .bind(install_location.as_deref())
        .bind(install_date.as_deref())
        .execute(&mut *tx)
        .await?;
        n += 1;
    }
    tx.commit().await?;
    Ok(n)
}

pub async fn list_agent_software(pool: &PgPool, agent_id: Uuid) -> Result<Vec<AgentSoftwareRow>> {
    let rows = sqlx::query(
        r#"
        SELECT name, version, publisher, install_location, install_date, captured_at
        FROM agent_software
        WHERE agent_id = $1
        ORDER BY lower(name) ASC
        "#,
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(AgentSoftwareRow {
            name: r.try_get("name")?,
            version: r.try_get("version")?,
            publisher: r.try_get("publisher")?,
            install_location: r.try_get("install_location")?,
            install_date: r.try_get("install_date")?,
            captured_at: r.try_get("captured_at")?,
        });
    }
    Ok(out)
}

pub async fn latest_software_capture_time(
    pool: &PgPool,
    agent_id: Uuid,
) -> Result<Option<DateTime<Utc>>> {
    let v: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(captured_at) FROM agent_software WHERE agent_id = $1",
    )
    .bind(agent_id)
    .fetch_one(pool)
    .await?;
    Ok(v)
}

// ─── Agent groups ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AgentGroupRow {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub member_count: i64,
}

pub async fn agent_groups_list(pool: &PgPool) -> Result<Vec<AgentGroupRow>> {
    let rows = sqlx::query(
        r#"
        SELECT g.id, g.name, g.description, g.created_at,
               COALESCE(COUNT(m.agent_id), 0)::BIGINT AS member_count
        FROM agent_groups g
        LEFT JOIN agent_group_members m ON m.group_id = g.id
        GROUP BY g.id, g.name, g.description, g.created_at
        ORDER BY lower(g.name)
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(AgentGroupRow {
            id: r.try_get("id")?,
            name: r.try_get("name")?,
            description: r.try_get("description")?,
            created_at: r.try_get("created_at")?,
            member_count: r.try_get("member_count")?,
        });
    }
    Ok(out)
}

pub async fn agent_group_create(pool: &PgPool, name: &str, description: &str) -> Result<Uuid> {
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO agent_groups (name, description)
        VALUES ($1, $2)
        RETURNING id
        "#,
    )
    .bind(name.trim())
    .bind(description)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn agent_group_delete(pool: &PgPool, id: Uuid) -> Result<bool> {
    let r = sqlx::query("DELETE FROM agent_groups WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn agent_group_rename(
    pool: &PgPool,
    id: Uuid,
    name: &str,
    description: &str,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE agent_groups SET name = $2, description = $3 WHERE id = $1",
    )
    .bind(id)
    .bind(name.trim())
    .bind(description)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn agent_group_add_members(
    pool: &PgPool,
    group_id: Uuid,
    agent_ids: &[Uuid],
) -> Result<u64> {
    let mut n = 0u64;
    for aid in agent_ids {
        let r = sqlx::query(
            "INSERT INTO agent_group_members (group_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(group_id)
        .bind(aid)
        .execute(pool)
        .await?;
        n += r.rows_affected();
    }
    Ok(n)
}

pub async fn agent_group_remove_member(pool: &PgPool, group_id: Uuid, agent_id: Uuid) -> Result<bool> {
    let r = sqlx::query(
        "DELETE FROM agent_group_members WHERE group_id = $1 AND agent_id = $2",
    )
    .bind(group_id)
    .bind(agent_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn agent_group_members(pool: &PgPool, group_id: Uuid) -> Result<Vec<Uuid>> {
    let rows: Vec<Uuid> = sqlx::query_scalar(
        "SELECT agent_id FROM agent_group_members WHERE group_id = $1 ORDER BY agent_id",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ─── Alert rules ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AlertRuleRow {
    pub id: i64,
    pub name: String,
    pub pattern: String,
    pub match_mode: String,
    pub case_insensitive: bool,
    pub cooldown_secs: i32,
}

/// Rules that apply to this agent (global + group memberships + direct agent scope).
pub async fn alert_rules_effective_for_agent(
    pool: &PgPool,
    agent_id: Uuid,
    channel: &str,
) -> Result<Vec<AlertRuleRow>> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT r.id, r.name, r.pattern, r.match_mode,
               r.case_insensitive, r.cooldown_secs
        FROM alert_rules r
        INNER JOIN alert_rule_scopes s ON s.rule_id = r.id
        WHERE r.enabled
          AND r.channel = $2
          AND (
            s.scope_kind = 'all'
            OR (s.scope_kind = 'agent' AND s.agent_id = $1)
            OR (
                s.scope_kind = 'group'
                AND s.group_id IN (
                    SELECT group_id FROM agent_group_members WHERE agent_id = $1
                )
            )
          )
        ORDER BY r.id
        "#,
    )
    .bind(agent_id)
    .bind(channel)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(AlertRuleRow {
            id: r.try_get("id")?,
            name: r.try_get("name")?,
            pattern: r.try_get("pattern")?,
            match_mode: r.try_get("match_mode")?,
            case_insensitive: r.try_get("case_insensitive")?,
            cooldown_secs: r.try_get("cooldown_secs")?,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertRuleScopeJson {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertRuleListItem {
    pub id: i64,
    pub name: String,
    pub channel: String,
    pub pattern: String,
    pub match_mode: String,
    pub case_insensitive: bool,
    pub cooldown_secs: i32,
    pub enabled: bool,
    pub scopes: Vec<AlertRuleScopeJson>,
}

pub async fn alert_rules_list_all(pool: &PgPool) -> Result<Vec<AlertRuleListItem>> {
    let rules = sqlx::query(
        r#"
        SELECT id, name, channel, pattern, match_mode, case_insensitive, cooldown_secs, enabled
        FROM alert_rules
        ORDER BY id
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rules.len());
    for r in rules {
        let id: i64 = r.try_get("id")?;
        let scopes_rows = sqlx::query(
            "SELECT scope_kind, group_id, agent_id FROM alert_rule_scopes WHERE rule_id = $1 ORDER BY id",
        )
        .bind(id)
        .fetch_all(pool)
        .await?;

        let mut scopes = Vec::with_capacity(scopes_rows.len());
        for s in scopes_rows {
            let kind: String = s.try_get("scope_kind")?;
            scopes.push(AlertRuleScopeJson {
                kind,
                group_id: s.try_get::<Option<Uuid>, _>("group_id")?,
                agent_id: s.try_get::<Option<Uuid>, _>("agent_id")?,
            });
        }

        out.push(AlertRuleListItem {
            id,
            name: r.try_get("name")?,
            channel: r.try_get("channel")?,
            pattern: r.try_get("pattern")?,
            match_mode: r.try_get("match_mode")?,
            case_insensitive: r.try_get("case_insensitive")?,
            cooldown_secs: r.try_get("cooldown_secs")?,
            enabled: r.try_get("enabled")?,
            scopes,
        });
    }
    Ok(out)
}

async fn alert_rule_scopes_write_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    rule_id: i64,
    scopes: &[(String, Option<Uuid>, Option<Uuid>)],
) -> Result<()> {
    let conn = tx.deref_mut();
    sqlx::query("DELETE FROM alert_rule_scopes WHERE rule_id = $1")
        .bind(rule_id)
        .execute(&mut *conn)
        .await?;

    for (kind, group_id, agent_id) in scopes {
        sqlx::query(
            r#"
            INSERT INTO alert_rule_scopes (rule_id, scope_kind, group_id, agent_id)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(rule_id)
        .bind(kind.as_str())
        .bind(group_id)
        .bind(agent_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub async fn alert_rule_create_with_scopes(
    pool: &PgPool,
    name: &str,
    channel: &str,
    pattern: &str,
    match_mode: &str,
    case_insensitive: bool,
    cooldown_secs: i32,
    enabled: bool,
    scopes: &[(String, Option<Uuid>, Option<Uuid>)],
) -> Result<i64> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO alert_rules (name, channel, pattern, match_mode, case_insensitive, cooldown_secs, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(name)
    .bind(channel)
    .bind(pattern)
    .bind(match_mode)
    .bind(case_insensitive)
    .bind(cooldown_secs)
    .bind(enabled)
    .fetch_one(tx.deref_mut())
    .await?;
    alert_rule_scopes_write_tx(&mut tx, id, scopes).await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn alert_rule_update_with_scopes(
    pool: &PgPool,
    rule_id: i64,
    name: &str,
    channel: &str,
    pattern: &str,
    match_mode: &str,
    case_insensitive: bool,
    cooldown_secs: i32,
    enabled: bool,
    scopes: &[(String, Option<Uuid>, Option<Uuid>)],
) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let r = sqlx::query(
        r#"
        UPDATE alert_rules
        SET name = $2, channel = $3, pattern = $4, match_mode = $5,
            case_insensitive = $6, cooldown_secs = $7, enabled = $8, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(rule_id)
    .bind(name)
    .bind(channel)
    .bind(pattern)
    .bind(match_mode)
    .bind(case_insensitive)
    .bind(cooldown_secs)
    .bind(enabled)
    .execute(tx.deref_mut())
    .await?;
    if r.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    alert_rule_scopes_write_tx(&mut tx, rule_id, scopes).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn alert_rule_delete(pool: &PgPool, rule_id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM alert_rules WHERE id = $1")
        .bind(rule_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertRuleEventRow {
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<i64>,
    pub rule_name: String,
    pub channel: String,
    pub snippet: String,
    pub created_at: DateTime<Utc>,
}

pub async fn alert_rule_event_insert(
    pool: &PgPool,
    agent_id: Uuid,
    rule_id: i64,
    rule_name: &str,
    channel: &str,
    snippet: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO alert_rule_events (agent_id, rule_id, rule_name, channel, snippet)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(agent_id)
    .bind(rule_id)
    .bind(rule_name)
    .bind(channel)
    .bind(snippet)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn alert_rule_events_list_for_agent(
    pool: &PgPool,
    agent_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<AlertRuleEventRow>> {
    let rows = sqlx::query(
        r#"
        SELECT id, rule_id, rule_name, channel, snippet, created_at
        FROM alert_rule_events
        WHERE agent_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(agent_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(AlertRuleEventRow {
            id: r.try_get("id")?,
            rule_id: r.try_get("rule_id")?,
            rule_name: r.try_get("rule_name")?,
            channel: r.try_get("channel")?,
            snippet: r.try_get("snippet")?,
            created_at: r.try_get("created_at")?,
        });
    }
    Ok(out)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

fn unix_to_dt(ts: Option<i64>) -> DateTime<Utc> {
    ts.and_then(|s| Utc.timestamp_opt(s, 0).single())
        .unwrap_or_else(Utc::now)
}
