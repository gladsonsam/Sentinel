//! Tauri-based settings window for the Sentinel agent.
//!
//! ## Architecture
//!
//! Tauri owns the main thread and its webview event loop.  The agent's
//! background Tokio runtime continues to run in a separate OS thread (spawned
//! by `main` before this module is called).
//!
//! Shared state is passed into the Tauri app via `.manage()`:
//! - `SharedConfig`  – `Arc<tokio::sync::watch::Sender<Option<Config>>>`
//! - `SharedStatus`  – `Arc<Mutex<AgentStatus>>`
//! - `StoredConfig`  – `Arc<Mutex<Config>>` (latest saved config, for reads)
//!
//! ## IPC Commands (webview → Rust)
//!
//! | Command              | Returns                  | Description                          |
//! |----------------------|--------------------------|--------------------------------------|
//! | `get_config`         | `Config` JSON            | Read current config                  |
//! | `save_config`        | `()`                     | Persist + hot-reload config          |
//! | `get_status`         | `StatusResponse` JSON    | Current WS connection status         |
//! | `has_ui_password`    | `bool`                   | Whether a UI password is set         |
//! | `verify_ui_password` | `()` or Err              | Check UI password                    |
//! | `hide_window`        | `()`                     | Hide the settings window             |
//! | `exit_agent`         | never                    | Kill the process                     |

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{error, info};

use crate::config::{AgentStatus, Config};

// ─── Shared state wrappers ─────────────────────────────────────────────────────

/// Watch sender — agent loop listens on the receiver end.
pub struct SharedConfigTx(pub tokio::sync::watch::Sender<Option<Config>>);

/// Latest saved config — shared with the background agent thread so server-pushed
/// UI password updates stay in sync with the settings window.
pub struct StoredConfig(pub Arc<Mutex<Config>>);

/// Agent connection status — written by the agent loop, read by `get_status`.
pub struct SharedStatus(pub Arc<Mutex<AgentStatus>>);

// ─── IPC command payloads ──────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct StatusResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Extended save payload: normal Config fields + an optional new plaintext password.
#[derive(serde::Deserialize)]
pub struct SaveConfigPayload {
    pub server_url: String,
    pub agent_name: String,
    pub agent_password: String,
    pub ui_password_hash: String,
    /// Present only when the user is changing the UI password.
    pub new_password: Option<String>,
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_config(stored: State<StoredConfig>) -> Config {
    stored.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(
    config: SaveConfigPayload,
    stored: State<StoredConfig>,
    config_tx: State<SharedConfigTx>,
) -> Result<(), String> {
    let ui_hash = if let Some(ref pw) = config.new_password {
        if pw.is_empty() {
            // Empty new_password → keep existing hash
            stored.0.lock().unwrap().ui_password_hash.clone()
        } else {
            crate::config::hash_password(pw)
        }
    } else {
        config.ui_password_hash.clone()
    };

    let new_cfg = Config {
        server_url: config.server_url.trim().to_string(),
        agent_name: config.agent_name.trim().to_string(),
        agent_password: config.agent_password,
        ui_password_hash: ui_hash,
    };

    crate::config::save_config(&new_cfg).map_err(|e| e.to_string())?;

    // Hot-reload: wake the agent loop with the new config.
    let _ = config_tx.0.send(Some(new_cfg.clone()));

    // Update the in-memory copy so subsequent get_config() reads are fresh.
    *stored.0.lock().unwrap() = new_cfg;

    info!("Config saved and hot-reloaded.");
    Ok(())
}

#[tauri::command]
fn get_status(status: State<SharedStatus>) -> StatusResponse {
    let s = status.0.lock().unwrap().clone();
    match s {
        AgentStatus::Connected => StatusResponse {
            status: "Connected".into(),
            message: None,
        },
        AgentStatus::Connecting => StatusResponse {
            status: "Connecting".into(),
            message: None,
        },
        AgentStatus::Disconnected => StatusResponse {
            status: "Disconnected".into(),
            message: None,
        },
        AgentStatus::Error(msg) => StatusResponse {
            status: "Error".into(),
            message: Some(msg),
        },
    }
}

#[tauri::command]
fn has_ui_password(stored: State<StoredConfig>) -> bool {
    let cfg = stored.0.lock().unwrap();
    let empty_hash = crate::config::hash_password("");
    !cfg.ui_password_hash.is_empty() && cfg.ui_password_hash != empty_hash
}

#[tauri::command]
fn verify_ui_password(password: String, stored: State<StoredConfig>) -> Result<(), String> {
    let cfg = stored.0.lock().unwrap();
    let hash = crate::config::hash_password(&password);
    if hash == cfg.ui_password_hash {
        Ok(())
    } else {
        Err("Wrong password".into())
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("lock_ui", ());
        // Fully destroy the webview to release WebView2 memory.
        // We'll recreate it on demand via Ctrl+Shift+F12 (or first-run).
        let _ = win.destroy();
    }
}

#[tauri::command]
fn exit_agent() {
    std::process::exit(0);
}

// ─── Public entry point ────────────────────────────────────────────────────────

/// Build and run the Tauri event loop.  **Blocks the calling thread forever**
/// (or until the user clicks "Exit Agent").
pub fn run_tauri(
    initial_config: Config,
    config_tx: tokio::sync::watch::Sender<Option<Config>>,
    shared_cfg: Arc<Mutex<Config>>,
    agent_status: Arc<Mutex<AgentStatus>>,
    show_on_startup: bool,
) {
    let app = tauri::Builder::default()
        // Ensure only one instance of the agent settings app runs.
        // If a second instance is launched, we focus/show the existing window
        // and the new instance exits automatically via the plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        // ── Plugins ─────────────────────────────────────────────────────────
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ── Shared state ────────────────────────────────────────────────────
        .manage(SharedConfigTx(config_tx))
        .manage(StoredConfig(shared_cfg))
        .manage(SharedStatus(agent_status))
        // ── Commands ────────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_status,
            has_ui_password,
            verify_ui_password,
            hide_window,
            exit_agent,
        ])
        // ── Setup ────────────────────────────────────────────────────────────
        .setup(move |app| {
            let win = app.get_webview_window("main").expect("main window missing");

            // Show on first run or explicit flag
            let is_first_run = initial_config.server_url.is_empty();
            if is_first_run || show_on_startup {
                let _ = win.show();
                let _ = win.set_focus();
            } else {
                // Not needed right now: destroy the webview so WebView2 doesn't sit
                // around consuming memory in the background.
                let _ = win.destroy();
            }

            // Register Ctrl+Shift+F12 global shortcut
            let app_handle = app.handle().clone();
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F12);

            app.global_shortcut()
                .on_shortcut(shortcut, move |_app_handle, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Creating a window in an event handler can deadlock on Windows (WebView2).
                        // Spawn a thread (Tauri docs recommendation).
                        let handle = app_handle.clone();
                        std::thread::spawn(move || {
                            if let Some(w) = handle.get_webview_window("main") {
                                let visible = w.is_visible().unwrap_or(false);
                                if visible {
                                    let _ = w.emit("lock_ui", ());
                                    let _ = w.destroy();
                                } else {
                                    let _ = w.emit("lock_ui", ());
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                                return;
                            }

                            // Recreate from config template (keeps size/min size/decorations consistent).
                            let cfg = handle
                                .config()
                                .app
                                .windows
                                .iter()
                                .find(|w| w.label == "main")
                                .or_else(|| handle.config().app.windows.get(0))
                                .cloned();

                            let Some(conf) = cfg else { return };
                            let _ = tauri::WebviewWindowBuilder::from_config(&handle, &conf)
                                .and_then(|b| b.build());

                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.emit("lock_ui", ());
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        });
                    }
                })
                .unwrap_or_else(|e| {
                    error!("Failed to register global shortcut Ctrl+Shift+F12: {e}");
                });

            info!("Tauri settings window initialised (show_on_startup={show_on_startup}).");
            Ok(())
        })
        // ── Window close → hide instead of quit ──────────────────────────────
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.emit("lock_ui", ());
                    // Destroy to reclaim WebView2 memory; recreate on demand.
                    if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                        let _ = w.destroy();
                    }
                }
                // Minimize doesn't have a dedicated event; but if it loses focus and is minimized,
                // destroy the window to release memory.
                tauri::WindowEvent::Focused(false) => {
                    if window.is_minimized().unwrap_or(false) {
                        let _ = window.emit("lock_ui", ());
                        if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                            let _ = w.destroy();
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            error!("Tauri runtime error: {e}");
            // Keep process alive so the agent background thread continues.
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        });

    // Critical: if we destroy the only window, Tauri may try to exit.
    // Prevent exit so the background agent keeps running; `exit_agent()` handles real shutdown.
    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();
        }
    });
}
