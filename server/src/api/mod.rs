//! REST API for the authenticated dashboard (`/api/*`).

mod agent_enrollment;
mod agents_capture;
mod agents_list;
mod agents_telemetry;
mod assets;
mod audit;
mod auto_update;
mod groups_and_rules;
mod helpers;
mod local_ui;
mod pagination;
mod retention;
mod settings;
mod software_scripts;
mod users;
mod version;

use std::sync::Arc;

use axum::{
    routing::{delete, get, post, put},
    Router,
};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/me", get(agents_list::me))
        .route("/agents", get(agents_list::list_agents))
        .route("/agents/overview", get(agents_list::list_agents_overview))
        .route(
            "/agents/:id/revoke-credentials",
            post(agents_list::revoke_agent_credentials),
        )
        .route("/agents/delete", post(agents_list::delete_agents_bulk))
        .route(
            "/agents/:id/icon",
            get(agents_list::agent_icon_get).put(agents_list::agent_icon_put),
        )
        .route("/users", get(users::users_list).post(users::users_create))
        .route("/users/:id/password", post(users::user_set_password))
        .route("/users/:id/profile", post(users::user_profile_update))
        .route("/users/:id/role", post(users::user_set_role))
        .route("/users/:id/delete", post(users::user_delete))
        .route("/users/:id/identities", get(users::user_identities))
        .route("/users/:id/identities/link", post(users::user_identity_link))
        .route("/identities/:id/unlink", post(users::identity_unlink))
        .route("/agents/bulk-script", post(software_scripts::agents_bulk_script))
        .route("/agents/:id/info", get(agents_telemetry::agent_info))
        .route("/agents/:id/windows", get(agents_telemetry::agent_windows))
        .route("/agents/:id/keys", get(agents_telemetry::agent_keys))
        .route(
            "/agents/:id/alert-rule-events",
            get(agents_telemetry::agent_alert_rule_events),
        )
        .route(
            "/agents/:id/groups",
            get(agents_telemetry::agent_agent_groups_for_agent_h),
        )
        .route(
            "/alert-rule-events/:id/screenshot",
            get(assets::alert_rule_event_screenshot),
        )
        .route("/agents/:id/urls", get(agents_telemetry::agent_urls))
        .route("/agents/:id/activity", get(agents_telemetry::agent_activity))
        .route(
            "/agents/:id/app-icons/:exe_name",
            get(assets::agent_app_icon),
        )
        .route("/agents/:id/top-urls", get(agents_telemetry::agent_top_urls))
        .route(
            "/agents/:id/top-windows",
            get(agents_telemetry::agent_top_windows),
        )
        .route(
            "/agents/:id/history/clear",
            post(agents_telemetry::clear_agent_history),
        )
        .route("/agents/:id/wake", post(agents_telemetry::agent_wake))
        .route(
            "/agents/:id/software",
            get(software_scripts::agent_software_list),
        )
        .route(
            "/agents/:id/software/collect",
            post(software_scripts::agent_software_collect),
        )
        .route(
            "/agents/:id/script",
            post(software_scripts::agent_run_script),
        )
        .route("/audit", get(audit::audit_log))
        .route(
            "/agents/:id/retention",
            get(retention::agent_retention_get)
                .put(retention::agent_retention_put)
                .delete(retention::agent_retention_delete),
        )
        .route("/agents/:id/screen", get(agents_capture::agent_screen))
        .route("/agents/:id/mjpeg", get(agents_capture::agent_mjpeg))
        .route(
            "/agents/:id/mjpeg/leave",
            post(agents_capture::agent_mjpeg_leave),
        )
        .route(
            "/settings/retention",
            get(retention::retention_global_get).put(retention::retention_global_put),
        )
        .route(
            "/settings/local-ui-password",
            get(local_ui::local_ui_password_global_get)
                .put(local_ui::local_ui_password_global_put),
        )
        .route(
            "/settings/agent-auto-update",
            get(auto_update::agent_auto_update_global_get)
                .put(auto_update::agent_auto_update_global_put),
        )
        .route(
            "/settings/agent-enrollment-tokens",
            get(agent_enrollment::list_enrollment_tokens).post(agent_enrollment::create_enrollment_token),
        )
        .route(
            "/settings/agent-enrollment-tokens/:id",
            delete(agent_enrollment::revoke_enrollment_token),
        )
        .route(
            "/settings/agent-enrollment-tokens/revoke-all",
            post(agent_enrollment::revoke_all_enrollment_tokens),
        )
        .route(
            "/settings/agent-enrollment-tokens/:id/uses",
            get(agent_enrollment::list_enrollment_token_uses),
        )
        .route(
            "/settings/agent-setup-hints",
            get(agent_enrollment::get_agent_setup_hints),
        )
        .route("/settings/storage", get(settings::storage_usage))
        .route("/settings/capabilities", get(settings::settings_capabilities))
        .route("/settings/version", get(version::settings_version))
        .route("/settings/integration", get(settings::settings_integration))
        .route(
            "/agents/:id/local-ui-password",
            get(local_ui::local_ui_password_agent_get)
                .put(local_ui::local_ui_password_agent_put)
                .delete(local_ui::local_ui_password_agent_delete),
        )
        .route(
            "/agents/:id/auto-update",
            get(auto_update::agent_auto_update_agent_get)
                .put(auto_update::agent_auto_update_agent_put)
                .delete(auto_update::agent_auto_update_agent_delete),
        )
        .route(
            "/agents/:id/update-now",
            post(agents_capture::agent_update_now),
        )
        .route(
            "/agent-groups",
            get(groups_and_rules::agent_groups_list_h).post(groups_and_rules::agent_groups_create_h),
        )
        .route(
            "/agent-groups/:group_id",
            put(groups_and_rules::agent_groups_update_h).delete(groups_and_rules::agent_groups_delete_h),
        )
        .route(
            "/agent-groups/:group_id/members",
            get(groups_and_rules::agent_group_members_list_h)
                .post(groups_and_rules::agent_group_members_add_h),
        )
        .route(
            "/agent-groups/:group_id/members/:agent_id",
            delete(groups_and_rules::agent_group_member_remove_h),
        )
        .route(
            "/alert-rules",
            get(groups_and_rules::alert_rules_list_h).post(groups_and_rules::alert_rules_create_h),
        )
        .route(
            "/alert-rules/:rule_id/events",
            get(agents_telemetry::alert_rule_events_for_rule_h),
        )
        .route(
            "/alert-rules/:rule_id",
            put(groups_and_rules::alert_rules_update_h).delete(groups_and_rules::alert_rules_delete_h),
        )
}
