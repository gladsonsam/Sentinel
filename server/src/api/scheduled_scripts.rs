use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{auth, db, state::AppState};
use super::helpers::{audit_ip, err500};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduledScriptScope {
    pub kind: String,
    pub group_id: Option<Uuid>,
    pub agent_id: Option<Uuid>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScheduledScriptSchedule {
    pub frequency: String,
    pub day_of_week: Option<i32>,
    pub fire_minute: i32,
}

#[derive(Serialize)]
pub struct ScheduledScriptRow {
    pub id: i64,
    pub name: String,
    pub shell: String,
    pub script: String,
    pub timeout_secs: i32,
    pub enabled: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub scopes: Vec<ScheduledScriptScope>,
    pub schedules: Vec<ScheduledScriptSchedule>,
}

pub async fn list_scripts(State(s): State<Arc<AppState>>) -> Response {
    let records = match sqlx::query(
        r#"
        SELECT 
            s.id, s.name, s.shell, s.script, s.timeout_secs, s.enabled, s.created_at, s.updated_at,
            COALESCE(json_agg(json_build_object('kind', sc.kind, 'group_id', sc.group_id, 'agent_id', sc.agent_id)) FILTER (WHERE sc.kind IS NOT NULL), '[]'::json) as scopes,
            COALESCE((
                SELECT json_agg(json_build_object('frequency', sch.frequency, 'day_of_week', sch.day_of_week, 'fire_minute', sch.fire_minute))
                FROM scheduled_script_schedules sch WHERE sch.script_id = s.id
            ), '[]'::json) as schedules
        FROM scheduled_scripts s
        LEFT JOIN scheduled_script_scopes sc ON sc.script_id = s.id
        GROUP BY s.id
        ORDER BY s.id DESC
        "#
    )
    .fetch_all(&s.db)
    .await
    {
        Ok(r) => r,
        Err(e) => return err500(e.into()),
    };

    let mut rules = Vec::new();
    for r in records {
        let scopes_val: serde_json::Value = r.try_get("scopes").unwrap_or_default();
        let scopes: Vec<ScheduledScriptScope> = serde_json::from_value(scopes_val).unwrap_or_default();
        
        let schedules_val: serde_json::Value = r.try_get("schedules").unwrap_or_default();
        let schedules: Vec<ScheduledScriptSchedule> = serde_json::from_value(schedules_val).unwrap_or_default();
        
        rules.push(ScheduledScriptRow {
            id: r.try_get("id").unwrap_or_default(),
            name: r.try_get("name").unwrap_or_default(),
            shell: r.try_get("shell").unwrap_or_default(),
            script: r.try_get("script").unwrap_or_default(),
            timeout_secs: r.try_get("timeout_secs").unwrap_or_default(),
            enabled: r.try_get("enabled").unwrap_or_default(),
            created_at: r.try_get("created_at").unwrap_or_default(),
            updated_at: r.try_get("updated_at").unwrap_or_default(),
            scopes,
            schedules,
        });
    }

    Json(serde_json::json!({ "scripts": rules })).into_response()
}

#[derive(Deserialize)]
pub struct CreateScheduledScriptBody {
    pub name: String,
    pub shell: String,
    pub script: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: i32,
    pub scopes: Vec<ScheduledScriptScope>,
    pub schedules: Vec<ScheduledScriptSchedule>,
}

fn default_timeout() -> i32 { 120 }

pub async fn create_script(
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<CreateScheduledScriptBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    
    let mut tx = match s.db.begin().await {
        Ok(t) => t,
        Err(e) => return err500(e.into()),
    };

    let id: i64 = match sqlx::query_scalar(
        "INSERT INTO scheduled_scripts (name, shell, script, timeout_secs) VALUES ($1, $2, $3, $4) RETURNING id"
    )
    .bind(&body.name)
    .bind(&body.shell)
    .bind(&body.script)
    .bind(body.timeout_secs)
    .fetch_one(&mut *tx)
    .await {
        Ok(id) => id,
        Err(e) => return err500(e.into()),
    };

    for scope in &body.scopes {
        if let Err(e) = sqlx::query(
            "INSERT INTO scheduled_script_scopes (script_id, kind, group_id, agent_id) VALUES ($1, $2, $3, $4)"
        )
        .bind(id)
        .bind(&scope.kind)
        .bind(scope.group_id)
        .bind(scope.agent_id)
        .execute(&mut *tx)
        .await {
            return err500(e.into());
        }
    }

    for sch in &body.schedules {
        if let Err(e) = sqlx::query(
            "INSERT INTO scheduled_script_schedules (script_id, frequency, day_of_week, fire_minute) VALUES ($1, $2, $3, $4)"
        )
        .bind(id)
        .bind(&sch.frequency)
        .bind(sch.day_of_week)
        .bind(sch.fire_minute)
        .execute(&mut *tx)
        .await {
            return err500(e.into());
        }
    }

    if let Err(e) = tx.commit().await {
        return err500(e.into());
    }

    let ip = audit_ip(&headers, addr);
    db::insert_audit_log_traced(
        &s.db,
        &user.username,
        None,
        "scheduled_script_create",
        "ok",
        &serde_json::json!({ "id": id, "name": body.name }),
        ip.as_deref(),
    ).await;

    (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response()
}

#[derive(Deserialize)]
pub struct UpdateScheduledScriptBody {
    pub enabled: Option<bool>,
    pub name: Option<String>,
    pub shell: Option<String>,
    pub script: Option<String>,
    pub timeout_secs: Option<i32>,
    pub scopes: Option<Vec<ScheduledScriptScope>>,
    pub schedules: Option<Vec<ScheduledScriptSchedule>>,
}

pub async fn update_script(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
    _headers: HeaderMap,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    Json(body): Json<UpdateScheduledScriptBody>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    
    let mut tx = match s.db.begin().await {
        Ok(t) => t,
        Err(e) => return err500(e.into()),
    };

    if let Some(enabled) = body.enabled {
        if let Err(e) = sqlx::query("UPDATE scheduled_scripts SET enabled = $1, updated_at = NOW() WHERE id = $2")
            .bind(enabled).bind(id).execute(&mut *tx).await { return err500(e.into()); }
    }
    if let Some(name) = body.name {
        if let Err(e) = sqlx::query("UPDATE scheduled_scripts SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name).bind(id).execute(&mut *tx).await { return err500(e.into()); }
    }
    if let Some(shell) = body.shell {
        if let Err(e) = sqlx::query("UPDATE scheduled_scripts SET shell = $1, updated_at = NOW() WHERE id = $2")
            .bind(shell).bind(id).execute(&mut *tx).await { return err500(e.into()); }
    }
    if let Some(script) = body.script {
        if let Err(e) = sqlx::query("UPDATE scheduled_scripts SET script = $1, updated_at = NOW() WHERE id = $2")
            .bind(script).bind(id).execute(&mut *tx).await { return err500(e.into()); }
    }
    if let Some(timeout_secs) = body.timeout_secs {
        if let Err(e) = sqlx::query("UPDATE scheduled_scripts SET timeout_secs = $1, updated_at = NOW() WHERE id = $2")
            .bind(timeout_secs).bind(id).execute(&mut *tx).await { return err500(e.into()); }
    }

    if let Some(scopes) = body.scopes {
        if let Err(e) = sqlx::query("DELETE FROM scheduled_script_scopes WHERE script_id = $1")
            .bind(id).execute(&mut *tx).await { return err500(e.into()); }
        for scope in &scopes {
            if let Err(e) = sqlx::query(
                "INSERT INTO scheduled_script_scopes (script_id, kind, group_id, agent_id) VALUES ($1, $2, $3, $4)"
            )
            .bind(id).bind(&scope.kind).bind(scope.group_id).bind(scope.agent_id)
            .execute(&mut *tx).await { return err500(e.into()); }
        }
    }

    if let Some(schedules) = body.schedules {
        if let Err(e) = sqlx::query("DELETE FROM scheduled_script_schedules WHERE script_id = $1")
            .bind(id).execute(&mut *tx).await { return err500(e.into()); }
        for sch in &schedules {
            if let Err(e) = sqlx::query(
                "INSERT INTO scheduled_script_schedules (script_id, frequency, day_of_week, fire_minute) VALUES ($1, $2, $3, $4)"
            )
            .bind(id).bind(&sch.frequency).bind(sch.day_of_week).bind(sch.fire_minute)
            .execute(&mut *tx).await { return err500(e.into()); }
        }
    }

    if let Err(e) = tx.commit().await {
        return err500(e.into());
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn trigger_script(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }

    // 1. Fetch script details
    let script: Option<(String, String, String, i32)> = match sqlx::query_as(
        "SELECT name, shell, script, timeout_secs FROM scheduled_scripts WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&s.db)
    .await {
        Ok(v) => v,
        Err(e) => return err500(e.into()),
    };

    let Some((_name, shell, script_body, timeout_secs)) = script else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Script not found" }))).into_response();
    };

    // 2. Fetch scopes
    let scopes: Vec<ScheduledScriptScope> = match sqlx::query_as(
        "SELECT kind, group_id, agent_id FROM scheduled_script_scopes WHERE script_id = $1"
    )
    .bind(id)
    .fetch_all(&s.db)
    .await {
        Ok(v) => v,
        Err(e) => return err500(e.into()),
    };

    let target_agents = match resolve_agents(&s.db, &scopes).await {
        Ok(v) => v,
        Err(e) => return err500(e.into()),
    };

    if target_agents.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "No agents in scope" }))).into_response();
    }

    let connected_agents = s.agents.lock().keys().cloned().collect::<std::collections::HashSet<_>>();
    let now_utc = chrono::Utc::now();
    // For manual triggers, we use the actual current time as expected_fire_time but maybe append "(manual)" or similar?
    // Actually, let's just use the current time truncated to seconds for consistency.
    let fire_time = now_utc;

    for agent_id in &target_agents {
        let is_online = connected_agents.contains(&agent_id);
        let status = if is_online { "fired" } else { "skipped_offline" };

        // Record execution
        let _ = sqlx::query(
            "INSERT INTO scheduled_script_executions (script_id, agent_id, status, expected_fire_time) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING"
        )
        .bind(id)
        .bind(agent_id)
        .bind(status)
        .bind(fire_time)
        .execute(&s.db)
        .await;

        if is_online {
            let s_clone = s.clone();
            let shell_clone = shell.clone();
            let body_clone = script_body.clone();
            let agent_id_val = *agent_id;
            tokio::spawn(async move {
                let result = crate::api::software_scripts::run_script_and_wait(
                    s_clone.clone(),
                    agent_id_val,
                    shell_clone,
                    body_clone,
                    timeout_secs as u64,
                ).await;

                let mut output = String::new();
                if let Some(stdout) = result.get("stdout").and_then(|v| v.as_str()) {
                    if !stdout.is_empty() {
                        output.push_str("--- STDOUT ---\n");
                        output.push_str(stdout);
                        output.push('\n');
                    }
                }
                if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str()) {
                    if !stderr.is_empty() {
                        output.push_str("--- STDERR ---\n");
                        output.push_str(stderr);
                        output.push('\n');
                    }
                }
                if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
                    if !err.is_empty() {
                        output.push_str("--- ERROR ---\n");
                        output.push_str(err);
                        output.push('\n');
                    }
                }

                let final_status = if (result.get("ok") == Some(&serde_json::json!(false))) || (result.get("error").is_some() && result.get("exit_code").is_none()) {
                    "error"
                } else if result.get("exit_code") == Some(&serde_json::json!(0)) {
                    "success"
                } else {
                    "failed"
                };

                let _ = sqlx::query(
                    "UPDATE scheduled_script_executions SET status = $1, output = $2 WHERE script_id = $3 AND agent_id = $4 AND expected_fire_time = $5"
                )
                .bind(final_status)
                .bind(output)
                .bind(id)
                .bind(agent_id_val)
                .bind(fire_time)
                .execute(&s_clone.db)
                .await;
            });
        }
    }

    Json(serde_json::json!({ "ok": true, "agent_count": target_agents.len() })).into_response()
}

pub async fn resolve_agents(db: &sqlx::PgPool, scopes: &[ScheduledScriptScope]) -> anyhow::Result<std::collections::HashSet<Uuid>> {
    let mut all = std::collections::HashSet::new();

    let has_all = scopes.iter().any(|s| s.kind == "all");
    if has_all {
        let rows: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM agents").fetch_all(db).await?;
        for id in rows { all.insert(id); }
        return Ok(all);
    }

    for scope in scopes {
        if scope.kind == "agent" {
            if let Some(aid) = scope.agent_id {
                all.insert(aid);
            }
        } else if scope.kind == "group" {
            if let Some(gid) = scope.group_id {
                let rows: Vec<Uuid> = sqlx::query_scalar("SELECT agent_id FROM agent_group_members WHERE group_id = $1")
                    .bind(gid)
                    .fetch_all(db)
                    .await?;
                for aid in rows { all.insert(aid); }
            }
        }
    }

    Ok(all)
}

pub async fn delete_script(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Extension(user): Extension<auth::AuthUser>,
) -> Response {
    if !user.is_admin() {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))).into_response();
    }
    match sqlx::query("DELETE FROM scheduled_scripts WHERE id = $1")
        .bind(id).execute(&s.db).await {
        Ok(_) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => err500(e.into()),
    }
}

#[derive(Deserialize)]
pub struct EventsQuery {
    pub limit: Option<i64>,
}

pub async fn events_all(
    State(s): State<Arc<AppState>>,
    Query(q): Query<EventsQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    match sqlx::query(
        r#"
        SELECT 
            e.script_id, e.agent_id, e.status, e.expected_fire_time, e.output,
            s.name as rule_name, a.name as agent_name
        FROM scheduled_script_executions e
        JOIN scheduled_scripts s ON s.id = e.script_id
        JOIN agents a ON a.id = e.agent_id
        ORDER BY e.expected_fire_time DESC
        LIMIT $1
        "#
    )
    .bind(limit)
    .fetch_all(&s.db)
    .await {
        Ok(rows) => {
            let mut results = Vec::new();
            for r in rows {
                results.push(serde_json::json!({
                    "script_id": r.try_get::<i64, _>("script_id").unwrap_or(0),
                    "agent_id": r.try_get::<Uuid, _>("agent_id").unwrap_or_default(),
                    "agent_name": r.try_get::<String, _>("agent_name").unwrap_or_default(),
                    "rule_name": r.try_get::<String, _>("rule_name").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "expected_fire_time": r.try_get::<chrono::DateTime<chrono::Utc>, _>("expected_fire_time").unwrap_or_default(),
                    "output": r.try_get::<Option<String>, _>("output").unwrap_or_default(),
                }));
            }
            Json(serde_json::json!({ "rows": results })).into_response()
        }
        Err(e) => err500(e.into())
    }
}

pub async fn events_for_script(
    Path(id): Path<i64>,
    State(s): State<Arc<AppState>>,
    Query(q): Query<EventsQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    match sqlx::query(
        r#"
        SELECT 
            e.script_id, e.agent_id, e.status, e.expected_fire_time, e.output,
            a.name as agent_name
        FROM scheduled_script_executions e
        JOIN agents a ON a.id = e.agent_id
        WHERE e.script_id = $1
        ORDER BY e.expected_fire_time DESC
        LIMIT $2
        "#
    )
    .bind(id)
    .bind(limit)
    .fetch_all(&s.db)
    .await {
        Ok(rows) => {
            let mut results = Vec::new();
            for r in rows {
                results.push(serde_json::json!({
                    "script_id": r.try_get::<i64, _>("script_id").unwrap_or(0),
                    "agent_id": r.try_get::<Uuid, _>("agent_id").unwrap_or_default(),
                    "agent_name": r.try_get::<String, _>("agent_name").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "expected_fire_time": r.try_get::<chrono::DateTime<chrono::Utc>, _>("expected_fire_time").unwrap_or_default(),
                    "output": r.try_get::<Option<String>, _>("output").unwrap_or_default(),
                }));
            }
            Json(serde_json::json!({ "rows": results })).into_response()
        }
        Err(e) => err500(e.into())
    }
}
