//! # Sentinel Agent (Windows)
//!
//! Connects to a remote WebSocket server and streams real-time telemetry.
//!
//! ## Startup flow
//!
//! 1. The **main thread** loads the saved configuration, spawns a background
//!    thread that runs a Tokio runtime + the agent WebSocket loop, then runs
//!    an egui/eframe event loop for the settings window (cross-platform).
//!
//! 2. The **background thread** installs the keyboard hook, then runs the
//!    reconnect loop.  Any time the user changes the server URL or agent name
//!    through the settings window, the new `Config` is sent over a
//!    `tokio::sync::watch` channel and the loop reconnects immediately.
//!
//! ## Settings window
//!
//! Press **Ctrl+Shift+F12** to open the settings webview; while visible it
//! appears on the taskbar. Close destroys the webview (recreated on next open);
//! only "Exit Agent" terminates the process.
//!
//! ## Outbound frames (agent → server)
//!
//! | Event                        | WS frame type  | JSON `"type"` field |
//! |------------------------------|----------------|---------------------|
//! | Screen frame (on-demand)     | `Binary`       | —                   |
//! | Buffered keystrokes          | `Text` (JSON)  | `"keys"`            |
//! | AFK transition               | `Text` (JSON)  | `"afk"`             |
//! | Return from AFK              | `Text` (JSON)  | `"active"`          |
//! | Foreground window changed    | `Text` (JSON)  | `"window_focus"`    |
//! | Active browser URL changed   | `Text` (JSON)  | `"url"`             |
//! | Installed software snapshot  | `Text` (JSON)  | `"software_inventory"` |
//!
//! ## Inbound frames (server → agent)
//!
//! | Command          | WS frame type | JSON `"type"` field   |
//! |------------------|---------------|-----------------------|
//! | Start streaming  | `Text` (JSON) | `"start_capture"`     |
//! | Stop streaming   | `Text` (JSON) | `"stop_capture"`      |
//! | Local UI password| `Text` (JSON) | `"set_local_ui_password_hash"` |
//! | Mouse move       | `Text` (JSON) | `"MouseMove"`         |
//! | Mouse click      | `Text` (JSON) | `"MouseClick"`        |
//! | Request info     | `Text` (JSON) | `"RequestInfo"`       |
//! | Restart host     | `Text` (JSON) | `"RestartHost"`       |
//! | Shutdown host    | `Text` (JSON) | `"ShutdownHost"`      |
//! | Collect software | `Text` (JSON) | `"CollectSoftware"`   |
//! | Run script       | `Text` (JSON) | `"RunScript"`         |
//! | Network policy   | `Text` (JSON) | `"set_network_policy"` |

// In release builds: suppress the console window so the agent runs silently.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_block;
mod app_display;
mod capture;
mod config;
#[cfg(target_os = "windows")]
mod enrollment;
mod mdns_discover;
mod input;
mod keyboard_capture;
mod network_policy;
mod remote_script;
#[cfg(target_os = "windows")]
mod service;
#[cfg(target_os = "windows")]
mod updater_client;
#[cfg(target_os = "windows")]
use crate::updater_client::UpdateViaServiceOutcome;
#[cfg(target_os = "windows")]
mod updater_manifest;
mod software_inventory;
mod system_info;
mod toast;
mod ui;
mod url_scraper;
mod win_icons;
mod window_tracker;

/// Single in-flight chunked upload from the dashboard (`WriteFileChunk`).
struct FileUploadSession {
    path: String,
    next_expected_chunk: usize,
    total_chunks: usize,
    bytes_written: u64,
}

static FILE_UPLOAD_SESSION: Mutex<Option<FileUploadSession>> = Mutex::new(None);

/// Raw bytes per `ReadFile` read and per dashboard `WriteFileChunk` payload (before base64).
/// Keep in sync with `REMOTE_FILE_CHUNK_BYTES` in `../../frontend/src/components/tabs/FilesTab.tsx`.
const REMOTE_FILE_CHUNK_BYTES: usize = 3 * 1024 * 1024;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use anyhow::{Context, Result};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use input::InputController;
use keyboard_capture::InputEvent;
use tokio::sync::mpsc;
use tokio::time::{interval, interval_at, Instant, MissedTickBehavior};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{protocol::frame::coding::CloseCode, protocol::CloseFrame, Message},
    MaybeTlsStream, WebSocketStream,
};
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Registry};
use window_tracker::WindowTracker;

use config::{AgentStatus, Config};

#[cfg(target_os = "windows")]
struct HeldHandle(#[allow(dead_code)] windows::Win32::Foundation::HANDLE);

// HANDLE is just a numeric/opaque OS handle. Holding it for process lifetime is safe.
#[cfg(target_os = "windows")]
unsafe impl Send for HeldHandle {}
#[cfg(target_os = "windows")]
unsafe impl Sync for HeldHandle {}

#[cfg(target_os = "windows")]
static USER_AGENT_MUTEX: std::sync::OnceLock<HeldHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
fn program_data_log_path(filename: &str) -> std::path::PathBuf {
    // Prefer a stable, shared location for service logs.
    // %ProgramData% is writable for LocalSystem and readable by admins.
    let base = std::env::var_os("ProgramData")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\ProgramData"));
    base.join("Sentinel").join(filename)
}

fn init_logging(
    preferred_log_file: Option<std::path::PathBuf>,
) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    // In Windows release builds we run with `windows_subsystem = "windows"`,
    // so there is often no console attached. Write logs to a file by default
    // so failures are visible.
    //
    // Override path by setting `AGENT_LOG_FILE` to an absolute path.
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let mut log_file_path = std::env::var("AGENT_LOG_FILE")
        .ok()
        .map(std::path::PathBuf::from)
        .or(preferred_log_file);

    if log_file_path.is_none() {
        let mut p = config::config_path();
        p.pop(); // .../sentinel
        p.push("agent.log");
        log_file_path = Some(p);
    }

    if let Some(path) = log_file_path {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(file) => {
                let (writer, guard) = tracing_appender::non_blocking(file);
                let file_layer = fmt::layer()
                    .with_target(false)
                    .with_thread_ids(false)
                    .compact()
                    .with_writer(writer);
                Registry::default()
                    .with(env_filter)
                    .with(file_layer)
                    .init();
                Some(guard)
            }
            Err(_) => {
                let stderr_layer = fmt::layer()
                    .with_target(false)
                    .with_thread_ids(false)
                    .compact();
                Registry::default()
                    .with(env_filter)
                    .with(stderr_layer)
                    .init();
                None
            }
        }
    } else {
        let stderr_layer = fmt::layer()
            .with_target(false)
            .with_thread_ids(false)
            .compact();
        Registry::default()
            .with(env_filter)
            .with(stderr_layer)
            .init();
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum frames to deliver per second.
const TARGET_FPS: u64 = 15;
const FRAME_INTERVAL_MS: u64 = 1_000 / TARGET_FPS;

/// How long to wait before attempting a reconnect after a failed session.
const RECONNECT_DELAY_SECS: u64 = 5;

/// Bounded capacity for the JPEG frame channel.
const FRAME_CHANNEL_CAP: usize = 4;

/// Bounded capacity for the outbound WebSocket message channel.
const OUTBOUND_CHANNEL_CAP: usize = 16;

/// How often to poll the foreground window for title/app changes.
const WINDOW_POLL_INTERVAL_MS: u64 = 200;

/// How often to sample the active browser URL (UIAutomation-backed).
const URL_POLL_INTERVAL_SECS: u64 = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Entry point  (synchronous — eframe owns the main thread)
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = std::env::args().collect();

    #[cfg(target_os = "windows")]
    if let Some(json_path) = parse_import_machine_config_arg(&args) {
        eprintln!("Importing machine-wide config from {} …", json_path.display());
        match crate::config::import_machine_config_from_json_file(&json_path) {
            Ok(()) => {
                eprintln!(
                    "Wrote machine-wide config to {} (DPAPI machine scope).",
                    crate::config::machine_config_path().display()
                );
            }
            Err(e) => {
                eprintln!("Import failed: {e:#}");
                std::process::exit(1);
            }
        }
        std::process::exit(0);
    }

    #[cfg(target_os = "windows")]
    if args.iter().any(|a| a == "--service") {
        let log_guard = init_logging(Some(program_data_log_path("service.log")));
        if let Some(g) = log_guard {
            service::set_service_log_guard(g);
        }
        info!("Sentinel agent v{}", env!("CARGO_PKG_VERSION"));
        info!("Starting in Windows service mode.");
        if let Err(e) = service::run_windows_service() {
            error!("Windows service failed: {e}");
        }
        return;
    }


    let _log_guard = init_logging(parse_log_file_arg(&args));
    info!("Sentinel agent v{}", env!("CARGO_PKG_VERSION"));

    // Exactly one **interactive** user-session process (this binary without `--service`).
    // A second launch exits immediately — that is not a second “agent product”, it is the same
    // installer/shortcut started twice. The Windows **service** is a separate process and uses
    // `service.log`; it launches this binary in the user session with `--log-file user-agent.log`.
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
        use windows::Win32::System::Threading::CreateMutexW;

        let name = crate::service::to_wide_z("Global\\SentinelAgentMain");
        let h: HANDLE = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) }
            .unwrap_or_default();
        if h.is_invalid() {
            warn!("CreateMutexW failed; continuing without single-instance guard.");
        } else {
            let err = unsafe { GetLastError() };
            if err == ERROR_ALREADY_EXISTS {
                let _ = unsafe { CloseHandle(h) };
                info!("Another Sentinel agent instance is already running; exiting.");
                return;
            }
            // Keep mutex held for process lifetime.
            let _ = USER_AGENT_MUTEX.set(HeldHandle(h));
        }
    }

    // Allow forcing the settings UI to show on startup (tray/hotkey is easy to miss).
    let show_ui_on_startup = args.iter().any(|a| a == "--show-ui")
        || std::env::var("AGENT_SHOW_UI")
            .map(|v| {
                matches!(
                    v.trim(),
                    "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
                )
            })
            .unwrap_or(false)
        || crate::config::take_reopen_settings_ui_after_restart();

    // Allow disabling the UI entirely (headless mode). Useful when running the
    // agent as a scheduled task / service where a window surface cannot be created.
    let no_ui = args.iter().any(|a| a == "--no-ui")
        || std::env::var("AGENT_NO_UI")
            .map(|v| {
                matches!(
                    v.trim(),
                    "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
                )
            })
            .unwrap_or(false);

    // ── Load persisted configuration ──────────────────────────────────────
    let initial_config = config::load_config();
    info!("Config file {:?}", config::config_path());
    #[cfg(target_os = "windows")]
    info!(
        "Machine-wide config on disk (readable): {}",
        config::machine_connection_policy_active()
    );

    // Shared with Tauri so server-pushed UI password updates apply everywhere.
    let shared_cfg: Arc<Mutex<Config>> = Arc::new(Mutex::new(initial_config.clone()));

    // ── Shared agent status (agent thread writes, GUI thread reads) ───────
    let agent_status: Arc<Mutex<AgentStatus>> = Arc::new(Mutex::new(AgentStatus::Disconnected));

    // ── Config watch channel (GUI thread writes, agent thread reads) ──────
    let initial_watch = if initial_config.server_url.is_empty() {
        None
    } else {
        Some(initial_config.clone())
    };
    let (config_tx, config_rx) = tokio::sync::watch::channel(initial_watch);

    // ── Synchronisation: wait for the keyboard hook to be installed ───────
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<()>>();

    // ── Background thread: Tokio runtime + agent WebSocket loop ──────────
    let status_bg = agent_status.clone();
    let shared_cfg_bg = shared_cfg.clone();
    let config_tx_bg = config_tx.clone();
    std::thread::Builder::new()
        .name("agent-runtime".into())
        .spawn(move || {
            // Few workers: the agent is mostly one WebSocket session plus short-lived
            // spawned tasks; a large default pool wastes RAM (thread stacks) on many-core PCs.
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .worker_threads(2)
                .build()
                .expect("Failed to build Tokio runtime");

            rt.block_on(async move {
                // Keyboard capture channels must be created inside the async context
                // because keyboard_capture::start() spawns a tokio task internally.
                let (key_tx, key_rx) = mpsc::unbounded_channel::<InputEvent>();
                match keyboard_capture::start(key_tx) {
                    Ok(()) => {
                        info!("Keyboard hook installed.");
                        let _ = ready_tx.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(anyhow::anyhow!("{e:#}")));
                        return; // Cannot continue without keyboard capture
                    }
                }

                let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>(FRAME_CHANNEL_CAP);
                run_agent_loop(
                    config_rx,
                    config_tx_bg,
                    shared_cfg_bg,
                    frame_tx,
                    frame_rx,
                    key_rx,
                    status_bg,
                )
                .await;
            });
        })
        .expect("Failed to spawn agent thread");

    // Block until the keyboard hook is ready (or failed)
    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(e)) => warn!("Keyboard capture failed to start: {e:#}"),
        Err(_) => warn!("Agent thread exited before keyboard hook was ready"),
    }

    if no_ui {
        info!("UI disabled (--no-ui / AGENT_NO_UI). Running headless.");
        loop {
            std::thread::sleep(Duration::from_secs(60));
        }
    } else {
        // ── Tauri settings window (main thread; Tauri owns the event loop) ──
        ui::run_tauri(
            initial_config,
            config_tx,
            shared_cfg,
            agent_status,
            show_ui_on_startup,
        );
    }
}

/// `sentinel-agent --import-machine-config C:\path\agent.json` (run elevated). Writes
/// `%ProgramData%\Sentinel\config.dat` with DPAPI machine scope.
#[cfg(target_os = "windows")]
fn parse_import_machine_config_arg(args: &[String]) -> Option<std::path::PathBuf> {
    if let Some(i) = args.iter().position(|a| a == "--import-machine-config") {
        if let Some(p) = args.get(i + 1) {
            let p = p.trim_matches('"').trim();
            if !p.is_empty() {
                return Some(std::path::PathBuf::from(p));
            }
        }
        return None;
    }
    if let Some(a) = args
        .iter()
        .find(|a| a.starts_with("--import-machine-config="))
    {
        let p = a
            .trim_start_matches("--import-machine-config=")
            .trim_matches('"')
            .trim();
        if !p.is_empty() {
            return Some(std::path::PathBuf::from(p));
        }
    }
    None
}

fn parse_log_file_arg(args: &[String]) -> Option<std::path::PathBuf> {
    // Optional CLI override (used by the Windows launcher service so we can always find logs).
    if let Some(i) = args.iter().position(|a| a == "--log-file") {
        if let Some(p) = args.get(i + 1) {
            let p = p.trim_matches('"').trim();
            if !p.is_empty() {
                return Some(std::path::PathBuf::from(p));
            }
        }
        return None;
    }
    if let Some(a) = args.iter().find(|a| a.starts_with("--log-file=")) {
        let p = a.trim_start_matches("--log-file=").trim_matches('"').trim();
        if !p.is_empty() {
            return Some(std::path::PathBuf::from(p));
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent loop with hot-reload of config
// ─────────────────────────────────────────────────────────────────────────────

async fn run_agent_loop(
    mut config_rx: tokio::sync::watch::Receiver<Option<Config>>,
    config_tx: tokio::sync::watch::Sender<Option<Config>>,
    shared_cfg: Arc<Mutex<Config>>,
    frame_tx: mpsc::Sender<Vec<u8>>,
    mut frame_rx: mpsc::Receiver<Vec<u8>>,
    mut key_rx: mpsc::UnboundedReceiver<InputEvent>,
    status: Arc<Mutex<AgentStatus>>,
) {
    // Load persisted app block rules from config so enforcement starts immediately.
    let shared_rules = app_block::new_shared_rules();
    {
        let cfg = shared_cfg.lock().unwrap();
        let persisted: Vec<app_block::BlockRule> = cfg
            .app_block_rules
            .iter()
            .map(app_block::BlockRule::from_stored)
            .collect();
        if !persisted.is_empty() {
            info!("Loaded {} persisted app block rule(s).", persisted.len());
            *shared_rules.lock().unwrap() = persisted;
        }
    }
    let kill_report_tx = app_block::new_kill_report_tx();
    let rules_for_enforcer = shared_rules.clone();
    let kill_tx_for_enforcer = kill_report_tx.clone();
    tokio::spawn(async move {
        app_block::run_enforcer(rules_for_enforcer, kill_tx_for_enforcer).await;
    });
    #[cfg(target_os = "windows")]
    if let Ok(true) = crate::enrollment::try_consume_pending_enrollment().await {
        let new_cfg = config::load_config();
        if let Ok(mut g) = shared_cfg.lock() {
            *g = new_cfg.clone();
        }
        let watch_val = if new_cfg.server_url.is_empty() {
            None
        } else {
            Some(new_cfg)
        };
        let _ = config_tx.send(watch_val);
    }

    // The capture stop-flag survives reconnects.
    let mut capture_stop: Option<Arc<AtomicBool>> = None;

    loop {
        // Snapshot current config (clears the "changed" flag too)
        let cfg_opt = config_rx.borrow_and_update().clone();

        match cfg_opt {
            None => {
                set_status(&status, AgentStatus::Disconnected);
                info!("No server URL configured – waiting for settings…");
                if config_rx.changed().await.is_err() {
                    return; // watch sender dropped = app exiting
                }
                continue;
            }
            Some(ref cfg) if cfg.server_url.is_empty() => {
                set_status(&status, AgentStatus::Disconnected);
                info!("Server URL is empty – waiting for settings…");
                if config_rx.changed().await.is_err() {
                    return;
                }
                continue;
            }
            Some(cfg) => {
                let ws_url = build_ws_url(&cfg);
                let ws_url_for_log = redact_secret_from_ws_url(&ws_url);
                set_status(&status, AgentStatus::Connecting);
                info!("Connecting to {ws_url_for_log} …");
                info!("Target FPS (streaming): {TARGET_FPS}");

                // Internet exposure requires TLS; refuse plaintext `ws://` URLs.
                if !ws_url.starts_with("wss://") {
                    set_status(
                        &status,
                        AgentStatus::Error(
                            "Refusing to connect: server URL must be wss:// (HTTPS required)"
                                .into(),
                        ),
                    );
                    // Do not log secrets embedded in the URL query string.
                    warn!(
                        "Refusing to connect due to non-TLS WebSocket URL: {}",
                        redact_secret_from_ws_url(&ws_url)
                    );
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)) => {}
                        _ = config_rx.changed() => { info!("Config changed – applying new settings immediately."); }
                    }
                    continue;
                }

                match connect_ws(&ws_url).await {
                    Ok((ws_stream, response)) => {
                        set_status(&status, AgentStatus::Connected);
                        info!("WebSocket connected (HTTP {}).", response.status().as_u16());
                        match run_session(RunSessionArgs {
                            ws_stream,
                            frame_tx: &frame_tx,
                            frame_rx: &mut frame_rx,
                            key_rx: &mut key_rx,
                            capture_stop: &mut capture_stop,
                            shared_cfg: shared_cfg.clone(),
                            config_tx: config_tx.clone(),
                            shared_rules: shared_rules.clone(),
                            kill_report_tx: kill_report_tx.clone(),
                        })
                        .await
                        {
                            Ok(()) => info!("Session closed gracefully."),
                            Err(e) => error!("Session error: {e:#}"),
                        }

                        // Stop the capture thread on every session end so it
                        // never bleeds into the next reconnect without an
                        // explicit start_capture from the server.
                        if let Some(stop) = capture_stop.take() {
                            stop.store(true, Ordering::Relaxed);
                            info!("Screen capture stopped (session ended).");
                        }

                        // Detach the kill-report sink so the enforcer doesn't
                        // accumulate events while disconnected.
                        *kill_report_tx.lock().unwrap() = None;

                        set_status(&status, AgentStatus::Disconnected);
                    }
                    Err(e) => {
                        set_status(&status, AgentStatus::Error(e.to_string()));
                        error!("Connection failed: {e:#}");
                    }
                }

                // Wait before reconnect; wake early if the user updates config
                info!("Reconnecting in {RECONNECT_DELAY_SECS}s …");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)) => {}
                    _ = config_rx.changed() => {
                        info!("Config changed – applying new settings immediately.");
                    }
                }
            }
        }
    }
}

async fn connect_ws(
    ws_url: &str,
) -> Result<(
    WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::handshake::client::Response,
)> {
    connect_async(ws_url)
        .await
        .context("WebSocket connect failed")
}

/// Bundles handles for [`run_session`] so the entry point stays under Clippy's argument limit.
struct RunSessionArgs<'a> {
    ws_stream: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    frame_tx: &'a mpsc::Sender<Vec<u8>>,
    frame_rx: &'a mut mpsc::Receiver<Vec<u8>>,
    key_rx: &'a mut mpsc::UnboundedReceiver<InputEvent>,
    capture_stop: &'a mut Option<Arc<AtomicBool>>,
    shared_cfg: Arc<Mutex<Config>>,
    config_tx: tokio::sync::watch::Sender<Option<Config>>,
    shared_rules: app_block::SharedRules,
    kill_report_tx: app_block::KillReportTx,
}

async fn run_session(args: RunSessionArgs<'_>) -> Result<()> {
    let RunSessionArgs {
        ws_stream,
        frame_tx,
        frame_rx,
        key_rx,
        capture_stop,
        shared_cfg,
        config_tx,
        shared_rules,
        kill_report_tx,
    } = args;

    // Register this session as the kill-event sink so the enforcer can report kills.
    let (kill_ev_tx, mut kill_ev_rx) = tokio::sync::mpsc::unbounded_channel::<app_block::KillEvent>();
    *kill_report_tx.lock().unwrap() = Some(kill_ev_tx);
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // ── Outbound message bus ──────────────────────────────────────────────
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(OUTBOUND_CHANNEL_CAP);

    let writer_handle = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if let Err(e) = ws_tx.send(msg).await {
                warn!("WS write error (writer exiting): {e}");
                break;
            }
        }
        let _ = ws_tx
            .send(Message::Close(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "agent shutting down".into(),
            })))
            .await;
        let _ = ws_tx.close().await;
    });

    // ── Send system info once per session ────────────────────────────────
    let info_payload = system_info::collect_agent_info().to_string();
    let _ = out_tx.send(Message::Text(info_payload)).await;

    // ── Input controller ──────────────────────────────────────────────────
    let mut controller = InputController::new().context("Failed to create input controller")?;

    // ── Window focus tracker ──────────────────────────────────────────────
    let mut win_tracker = WindowTracker::new();
    let mut sent_app_icons: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── Timers ────────────────────────────────────────────────────────────
    let mut frame_ticker = interval(Duration::from_millis(FRAME_INTERVAL_MS));
    let mut url_ticker = interval(Duration::from_secs(URL_POLL_INTERVAL_SECS));
    let mut window_ticker = interval(Duration::from_millis(WINDOW_POLL_INTERVAL_MS));

    // First software inventory ~1 minute after connect, then every 24 hours.
    let mut software_ticker = interval_at(
        Instant::now() + Duration::from_secs(60),
        Duration::from_secs(86_400),
    );

    frame_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    url_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    window_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    software_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    // ── Event loop ────────────────────────────────────────────────────────
    let result: Result<()> = loop {
        tokio::select! {
            biased;

            // ── Branch 1: inbound server commands ────────────────────────
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_command(
                            &text,
                            frame_tx,
                            capture_stop,
                            &mut controller,
                            &shared_cfg,
                            &config_tx,
                            out_tx.clone(),
                            &shared_rules,
                        );
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame.as_ref()
                            .map(|f| f.reason.as_ref())
                            .unwrap_or("no reason");
                        info!("Server sent Close frame: {reason}");
                        break Ok(());
                    }
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(_)) => {}
                    Some(Err(e)) => break Err(anyhow::anyhow!("WS receive error: {e}")),
                    None => {
                        info!("WebSocket stream ended.");
                        break Ok(());
                    }
                }
            }

            // ── Branch 2: app block kill reports ─────────────────────────
            ev = kill_ev_rx.recv() => {
                if let Some(kill) = ev {
                    let payload = serde_json::json!({
                        "type": "app_block_kill",
                        "rule_id": kill.rule_id,
                        "rule_name": kill.rule_name,
                        "exe_name": kill.exe_name,
                    }).to_string();
                    let _ = out_tx.send(Message::Text(payload)).await;
                }
            }

            // ── Branch 3: screen frame delivery ──────────────────────────
            _ = frame_ticker.tick() => {
                let mut latest: Option<Vec<u8>> = None;
                while let Ok(jpeg) = frame_rx.try_recv() {
                    latest = Some(jpeg);
                }
                if let Some(jpeg) = latest {
                    if out_tx.send(Message::Binary(jpeg)).await.is_err() {
                        break Err(anyhow::anyhow!(
                            "Outbound channel closed; writer task exited unexpectedly."
                        ));
                    }
                }
            }

            // ── Branch 3: active browser URL ─────────────────────────────
            _ = url_ticker.tick() => {
                if let Some(info) = url_scraper::get_active_url() {
                    let legacy = serde_json::json!({
                        "type"    : "url",
                        "url"     : info.url,
                        "title"   : info.title,
                        "browser" : info.browser_name,
                        "ts"      : unix_timestamp_secs(),
                    })
                    .to_string();
                    if out_tx.send(Message::Text(legacy)).await.is_err() {
                        break Err(anyhow::anyhow!(
                            "Outbound channel closed; writer task exited unexpectedly."
                        ));
                    }
                }
            }

            // ── Branch 4: keystrokes / AFK ───────────────────────────────
            event = key_rx.recv() => {
                let payload = match event {
                    Some(InputEvent::Keys {
                        text,
                        app,
                        app_display,
                        window,
                        ts,
                    }) => {
                        serde_json::json!({
                            "type"   : "keys",
                            "text"   : text,
                            "app"    : app,
                            "app_display": app_display,
                            "window" : window,
                            "ts"     : ts,
                        })
                        .to_string()
                    }
                    Some(InputEvent::Afk { idle_secs }) => {
                        serde_json::json!({
                            "type"     : "afk",
                            "idle_secs": idle_secs,
                            "ts"       : unix_timestamp_secs(),
                        })
                        .to_string()
                    }
                    Some(InputEvent::Active) => {
                        serde_json::json!({
                            "type": "active",
                            "ts"  : unix_timestamp_secs(),
                        })
                        .to_string()
                    }
                    None => break Ok(()),
                };
                if out_tx.send(Message::Text(payload)).await.is_err() {
                    break Err(anyhow::anyhow!(
                        "Outbound channel closed; writer task exited unexpectedly."
                    ));
                }
            }

            // ── Branch 5: foreground window changes ───────────────────────
            _ = window_ticker.tick() => {
                if let Some(event) = win_tracker.poll() {
                    // Opportunistically upload an app icon once per exe name per session.
                    // This keeps the dashboard snappy without requiring extra round trips.
                    let exe_key = event.app.trim().to_lowercase();
                    if !exe_key.is_empty() && !sent_app_icons.contains(&exe_key) && !event.app_path.trim().is_empty() {
                        // `ExtractIconExW` often fails for our own EXE even with a valid installer icon.
                        // Fall back to the bundled `icons/icon.ico` so Activity shows a tile on the server.
                        let png = match win_icons::icon_png_from_exe_path(&event.app_path, 64) {
                            Ok(p) => Ok(p),
                            Err(_) if win_icons::is_current_process_exe(&event.app_path) => {
                                win_icons::sentinel_brand_icon_png()
                            }
                            Err(e) => Err(e),
                        };
                        if let Ok(png) = png {
                            let payload = serde_json::json!({
                                "type": "app_icon",
                                "exe_name": exe_key,
                                "png_base64": base64::engine::general_purpose::STANDARD.encode(png),
                                "ts": unix_timestamp_secs(),
                            }).to_string();
                            // Best-effort; ignore failures (icons are optional).
                            let _ = out_tx.send(Message::Text(payload)).await;
                        }
                        // Avoid retrying constantly for executables that can't produce icons.
                        sent_app_icons.insert(exe_key);
                    }
                    let payload = serde_json::json!({
                        "type"  : "window_focus",
                        "title" : event.title,
                        "app"   : event.app,
                        "app_display": event.app_display,
                        "app_path": event.app_path,
                        "hwnd"  : event.hwnd,
                        "ts"    : unix_timestamp_secs(),
                    })
                    .to_string();
                    if out_tx.send(Message::Text(payload)).await.is_err() {
                        break Err(anyhow::anyhow!(
                            "Outbound channel closed; writer task exited unexpectedly."
                        ));
                    }
                }
            }

            // ── Branch 6: daily installed-software inventory ──────────────
            _ = software_ticker.tick() => {
                let o = out_tx.clone();
                tokio::spawn(async move {
                    software_inventory::send_inventory(o).await;
                });
            }
        }
    };

    // ── Shutdown ──────────────────────────────────────────────────────────
    drop(out_tx);
    if let Err(e) = writer_handle.await {
        warn!("Writer task panicked: {e}");
    }

    result
}

// ─────────────────────────────────────────────────────────────────────────────
// Server command handler
// ─────────────────────────────────────────────────────────────────────────────

fn handle_server_command(
    text: &str,
    frame_tx: &mpsc::Sender<Vec<u8>>,
    capture_stop: &mut Option<Arc<AtomicBool>>,
    controller: &mut InputController,
    shared_cfg: &Arc<Mutex<Config>>,
    config_tx: &tokio::sync::watch::Sender<Option<Config>>,
    out_tx: mpsc::Sender<Message>,
    shared_rules: &app_block::SharedRules,
) {
    let val: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    match val["type"].as_str().unwrap_or("") {
        "RequestInfo" => {
            let payload = system_info::collect_agent_info().to_string();
            let tx = out_tx.clone();
            tokio::spawn(async move {
                let _ = tx.send(Message::Text(payload)).await;
            });
            info!("Received RequestInfo command; pushed fresh system info.");
        }
        "RestartHost" => {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                match std::process::Command::new("shutdown")
                    .creation_flags(CREATE_NO_WINDOW)
                    .args(["/r", "/t", "0", "/f"])
                    .status()
                {
                    Ok(status) if status.success() => {
                        info!("Received RestartHost command; restart initiated.");
                    }
                    Ok(status) => {
                        warn!("RestartHost command failed with status: {status}");
                    }
                    Err(e) => {
                        warn!("Failed to execute RestartHost command: {e}");
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                warn!("RestartHost command received on non-Windows build; ignored.");
            }
        }
        "ShutdownHost" => {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                match std::process::Command::new("shutdown")
                    .creation_flags(CREATE_NO_WINDOW)
                    .args(["/s", "/t", "0", "/f"])
                    .status()
                {
                    Ok(status) if status.success() => {
                        info!("Received ShutdownHost command; shutdown initiated.");
                    }
                    Ok(status) => {
                        warn!("ShutdownHost command failed with status: {status}");
                    }
                    Err(e) => {
                        warn!("Failed to execute ShutdownHost command: {e}");
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                warn!("ShutdownHost command received on non-Windows build; ignored.");
            }
        }
        "set_local_ui_password_hash" => {
            if let Some(hash) = val["hash"].as_str() {
                if let Ok(mut c) = shared_cfg.lock() {
                    c.ui_password_hash = hash.to_string();
                    match crate::config::save_config(&c) {
                        Ok(()) => {
                            let new_cfg = c.clone();
                            drop(c);
                            let _ = config_tx.send(Some(new_cfg));
                            info!("Local settings UI password updated from server.");
                        }
                        Err(e) => warn!("Failed to save config (server UI password): {e}"),
                    }
                }
            }
        }
        "set_auto_update" => {
            if let Some(enabled) = val["enabled"].as_bool() {
                if let Ok(mut c) = shared_cfg.lock() {
                    c.auto_update_enabled = enabled;
                    match crate::config::save_config(&c) {
                        Ok(()) => {
                            let new_cfg = c.clone();
                            drop(c);
                            let _ = config_tx.send(Some(new_cfg));
                            info!("Auto-update setting updated from server (enabled={enabled}).");
                        }
                        Err(e) => warn!("Failed to save config (server auto_update): {e}"),
                    }
                }
            }
        }
        "set_network_policy" => {
            let blocked = val["blocked"].as_bool().unwrap_or(false);
            let (hostname, port, was_blocked) = {
                let c = shared_cfg.lock().unwrap();
                let (h, p) = crate::network_policy::parse_server_host_port(&c.server_url)
                    .unwrap_or_else(|| (String::new(), 443));
                (h, p, c.internet_blocked)
            };
            // Only act when state actually changes (or re-apply on reconnect when already blocked).
            let needs_action = blocked || was_blocked;
            if needs_action {
                #[cfg(target_os = "windows")]
                {
                    // Delegate to the LocalSystem service so netsh runs with full privileges.
                    let h = hostname.clone();
                    tokio::spawn(async move {
                        match crate::updater_client::set_network_policy_via_service(blocked, &h, port).await {
                            Ok(()) => info!("Network policy applied via service (blocked={blocked})."),
                            Err(e) => {
                                // Service pipe unavailable (e.g. running standalone in dev) — try direct.
                                warn!("Service pipe unavailable, falling back to direct netsh: {e}");
                                let direct = if blocked {
                                    crate::network_policy::apply_block(&h, port)
                                } else {
                                    crate::network_policy::remove_block()
                                };
                                if let Err(e2) = direct {
                                    warn!("Direct netsh also failed: {e2}");
                                } else {
                                    info!("Network policy applied directly (blocked={blocked}).");
                                }
                            }
                        }
                    });
                }
                #[cfg(not(target_os = "windows"))]
                {
                    if blocked {
                        if let Err(e) = crate::network_policy::apply_block(&hostname, port) {
                            warn!("Failed to apply network block: {e}");
                        }
                    } else if let Err(e) = crate::network_policy::remove_block() {
                        warn!("Failed to remove network block: {e}");
                    }
                }
            }
            if let Ok(mut c) = shared_cfg.lock() {
                c.internet_blocked = blocked;
                match crate::config::save_config(&c) {
                    Ok(()) => {
                        let new_cfg = c.clone();
                        drop(c);
                        let _ = config_tx.send(Some(new_cfg));
                        info!("Network policy updated from server (blocked={blocked}).");
                    }
                    Err(e) => warn!("Failed to save config (network policy): {e}"),
                }
            }
        }
        "set_app_block_rules" => {
            let rules: Vec<app_block::BlockRule> = val["rules"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect();
            {
                let mut lock = shared_rules.lock().unwrap();
                *lock = rules.clone();
            }
            if let Ok(mut c) = shared_cfg.lock() {
                c.app_block_rules = rules.iter().map(|r| r.to_stored()).collect();
                match crate::config::save_config(&c) {
                    Ok(()) => {
                        info!("App block rules updated from server ({} rules).", rules.len());
                    }
                    Err(e) => warn!("Failed to save app block rules to config: {e}"),
                }
            }
        }
        "update_now" => {
            #[cfg(target_os = "windows")]
            {
                let tx = out_tx.clone();
                tokio::spawn(async move {
                    match crate::updater_client::update_via_service().await {
                        Ok(UpdateViaServiceOutcome::InstallStarted) => {
                            let _ = tx
                                .send(Message::Text(
                                    serde_json::json!({
                                        "type": "notify",
                                        "level": "info",
                                        "message": "Update downloaded; installing…"
                                    })
                                    .to_string(),
                                ))
                                .await;
                            crate::updater_client::exit_for_update();
                        }
                        Ok(UpdateViaServiceOutcome::UpToDate) => {
                            let _ = tx
                                .send(Message::Text(
                                    serde_json::json!({
                                        "type": "notify",
                                        "level": "info",
                                        "message": "Already running the latest published version (no install needed)."
                                    })
                                    .to_string(),
                                ))
                                .await;
                        }
                        Err(e) => {
                            warn!("Update via service failed: {e:#}");
                        }
                    }
                });
            }
            #[cfg(not(target_os = "windows"))]
            {
                // Best-effort: if UI/Tauri is running, trigger an immediate updater check.
                crate::ui::trigger_update_now();
            }
        }
        "start_capture" => {
            if capture_stop.is_none() {
                let stop = Arc::new(AtomicBool::new(false));
                match capture::start_capture(frame_tx.clone(), stop.clone()) {
                    Ok(()) => {
                        *capture_stop = Some(stop);
                        info!("Screen capture started (viewer connected).");
                    }
                    Err(e) => warn!("Failed to start capture: {e}"),
                }
            }
        }
        "stop_capture" => {
            if let Some(stop) = capture_stop.take() {
                stop.store(true, Ordering::Relaxed);
                info!("Screen capture stopped (no viewers remaining).");
            }
        }
        "ListLogSources" => {
            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let out = out_tx.clone();
            tokio::spawn(async move {
                fn sources() -> Vec<serde_json::Value> {
                    let mut out = Vec::new();

                    #[cfg(windows)]
                    let local = crate::config::program_data_sentinel_dir().join("agent.log");
                    #[cfg(not(windows))]
                    let local = {
                        let mut p = crate::config::config_path();
                        p.pop();
                        p.push("agent.log");
                        p
                    };
                    out.push(serde_json::json!({
                        "id": "local_agent",
                        "label": "Interactive agent (agent.log, with config)",
                        "path": local.display().to_string(),
                    }));

                    #[cfg(windows)]
                    {
                        let pd = crate::config::program_data_sentinel_dir();
                        out.push(serde_json::json!({
                            "id": "user_agent",
                            "label": "User session started by service (user-agent.log)",
                            "path": pd.join("user-agent.log").display().to_string(),
                        }));
                        out.push(serde_json::json!({
                            "id": "service",
                            "label": "Windows service (service.log)",
                            "path": pd.join("service.log").display().to_string(),
                        }));
                    }

                    if let Ok(p) = std::env::var("AGENT_LOG_FILE") {
                        let t = p.trim();
                        if !t.is_empty() {
                            out.push(serde_json::json!({
                                "id": "env",
                                "label": "This process (AGENT_LOG_FILE)",
                                "path": t.to_string(),
                            }));
                        }
                    }

                    out
                }

                let payload = serde_json::json!({
                    "type": "log_sources",
                    "request_id": request_id,
                    "sources": sources(),
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "ReadLogTail" => {
            const MAX_LOG_KIND_CHARS: usize = 64;
            const MAX_KB_DEFAULT: u32 = 512;
            const MAX_KB_LIMIT: u32 = 2048;

            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let kind = val["kind"]
                .as_str()
                .unwrap_or("local_agent")
                .trim()
                .chars()
                .take(MAX_LOG_KIND_CHARS)
                .collect::<String>();
            if kind.is_empty() {
                return;
            }
            let max_kb = val["max_kb"]
                .as_u64()
                .map(|u| u as u32)
                .unwrap_or(MAX_KB_DEFAULT)
                .min(MAX_KB_LIMIT);
            let max_bytes = (max_kb as usize).saturating_mul(1024);

            fn resolve_log_kind(kind: &str) -> Result<std::path::PathBuf, String> {
                match kind {
                    "local_agent" => {
                        #[cfg(windows)]
                        {
                            Ok(crate::config::program_data_sentinel_dir().join("agent.log"))
                        }
                        #[cfg(not(windows))]
                        {
                            let mut p = crate::config::config_path();
                            p.pop();
                            p.push("agent.log");
                            Ok(p)
                        }
                    }
                    "service" => {
                        #[cfg(windows)]
                        {
                            Ok(crate::config::program_data_sentinel_dir().join("service.log"))
                        }
                        #[cfg(not(windows))]
                        {
                            Err("service.log is only used on Windows".into())
                        }
                    }
                    "user_agent" => {
                        #[cfg(windows)]
                        {
                            Ok(crate::config::program_data_sentinel_dir().join("user-agent.log"))
                        }
                        #[cfg(not(windows))]
                        {
                            Err("user-agent.log is only used on Windows".into())
                        }
                    }
                    "env" => std::env::var("AGENT_LOG_FILE")
                        .map_err(|_| "AGENT_LOG_FILE is not set in this process".into())
                        .map(std::path::PathBuf::from),
                    _ => Err(format!("unknown log source: {kind}")),
                }
            }

            fn strip_ansi_escapes(input: &str) -> String {
                let mut out = String::with_capacity(input.len());
                let mut chars = input.chars().peekable();
                while let Some(c) = chars.next() {
                    if c == '\u{1b}' {
                        if chars.peek() == Some(&'[') {
                            chars.next();
                            while let Some(&ch) = chars.peek() {
                                chars.next();
                                if ch.is_ascii_alphabetic() {
                                    break;
                                }
                            }
                            continue;
                        }
                    }
                    out.push(c);
                }
                out
            }

            let out = out_tx.clone();
            tokio::spawn(async move {
                let path = match resolve_log_kind(kind.as_str()) {
                    Ok(p) => p,
                    Err(e) => {
                        let payload = serde_json::json!({
                            "type": "log_tail",
                            "request_id": request_id,
                            "kind": kind,
                            "text": format!("(Could not resolve log source: {e})"),
                        })
                        .to_string();
                        let _ = out.send(Message::Text(payload)).await;
                        return;
                    }
                };

                let read_res = tokio::task::spawn_blocking(move || -> String {
                    use std::fs::File;
                    use std::io::{Read, Seek, SeekFrom};
                    use std::path::Path;

                    fn read_file_tail(path: &Path, max_bytes: usize) -> std::io::Result<String> {
                        let mut f = File::open(path)?;
                        let len = f.metadata()?.len();
                        let start = len.saturating_sub(max_bytes as u64);
                        f.seek(SeekFrom::Start(start))?;
                        let mut buf = Vec::new();
                        f.read_to_end(&mut buf)?;
                        Ok(String::from_utf8_lossy(&buf).into_owned())
                    }

                    if !path.exists() {
                        return format!(
                            "(File not found: {})\n\nLogs appear here after that component writes its first line.",
                            path.display()
                        );
                    }
                    match read_file_tail(&path, max_bytes) {
                        Ok(s) if s.is_empty() => "(Log file is empty.)".into(),
                        Ok(s) => strip_ansi_escapes(&s),
                        Err(e) => format!("(Could not read log: {e})"),
                    }
                })
                .await;

                let text = match read_res {
                    Ok(s) => s,
                    Err(e) => format!("(Log read task failed: {e})"),
                };

                let payload = serde_json::json!({
                    "type": "log_tail",
                    "request_id": request_id,
                    "kind": kind,
                    "text": text,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "Mkdir" => {
            const MAX_PATH_CHARS: usize = 2048;
            const MAX_NAME_CHARS: usize = 256;
            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let base = val["path"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            let name = val["name"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_NAME_CHARS)
                .collect::<String>();
            if base.is_empty() || name.is_empty() {
                return;
            }
            // Basic safety: avoid path traversal via separators in the folder name.
            if name.contains('\\') || name.contains('/') {
                return;
            }
            let out = out_tx.clone();
            tokio::spawn(async move {
                let full = if base.ends_with('\\') {
                    format!("{base}{name}")
                } else {
                    format!("{base}\\{name}")
                };
                let res = tokio::fs::create_dir_all(&full).await;
                let (ok, error) = match res {
                    Ok(()) => (true, None),
                    Err(e) => (false, Some(e.to_string())),
                };
                let payload = serde_json::json!({
                    "type": "fs_op_result",
                    "request_id": request_id,
                    "op": "mkdir",
                    "ok": ok,
                    "path": full,
                    "error": error,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "RenamePath" => {
            const MAX_PATH_CHARS: usize = 2048;
            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let src = val["src"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            let dst = val["dst"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            if src.is_empty() || dst.is_empty() {
                return;
            }
            let out = out_tx.clone();
            tokio::spawn(async move {
                // Ensure parent dir exists for a move/rename.
                if let Some(parent) = std::path::Path::new(&dst).parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                let res = tokio::fs::rename(&src, &dst).await;
                let (ok, error) = match res {
                    Ok(()) => (true, None),
                    Err(e) => (false, Some(e.to_string())),
                };
                let payload = serde_json::json!({
                    "type": "fs_op_result",
                    "request_id": request_id,
                    "op": "rename",
                    "ok": ok,
                    "src": src,
                    "dst": dst,
                    "error": error,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "DeletePath" => {
            const MAX_PATH_CHARS: usize = 2048;
            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let path = val["path"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            if path.is_empty() {
                return;
            }
            let recursive = val["recursive"].as_bool().unwrap_or(false);
            let out = out_tx.clone();
            tokio::spawn(async move {
                let meta = tokio::fs::metadata(&path).await;
                let res = match meta {
                    Ok(m) if m.is_dir() => {
                        if recursive {
                            tokio::fs::remove_dir_all(&path).await
                        } else {
                            tokio::fs::remove_dir(&path).await
                        }
                    }
                    Ok(_) => tokio::fs::remove_file(&path).await,
                    Err(e) => Err(e),
                };
                let (ok, error) = match res {
                    Ok(()) => (true, None),
                    Err(e) => (false, Some(e.to_string())),
                };
                let payload = serde_json::json!({
                    "type": "fs_op_result",
                    "request_id": request_id,
                    "op": "delete",
                    "ok": ok,
                    "path": path,
                    "recursive": recursive,
                    "error": error,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "CopyPath" => {
            const MAX_PATH_CHARS: usize = 2048;
            let request_id = val["request_id"].as_str().unwrap_or("").trim().to_string();
            if request_id.is_empty() {
                return;
            }
            let src = val["src"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            let dst = val["dst"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_PATH_CHARS)
                .collect::<String>();
            if src.is_empty() || dst.is_empty() {
                return;
            }
            let out = out_tx.clone();
            tokio::spawn(async move {
                // Only support file copy for now (directories require recursive copy).
                let meta = tokio::fs::metadata(&src).await;
                let res = match meta {
                    Ok(m) if m.is_dir() => Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "CopyPath for directories is not supported",
                    )),
                    Ok(_) => {
                        if let Some(parent) = std::path::Path::new(&dst).parent() {
                            let _ = tokio::fs::create_dir_all(parent).await;
                        }
                        tokio::fs::copy(&src, &dst).await.map(|_| ())
                    }
                    Err(e) => Err(e),
                };
                let (ok, error) = match res {
                    Ok(()) => (true, None),
                    Err(e) => (false, Some(e.to_string())),
                };
                let payload = serde_json::json!({
                    "type": "fs_op_result",
                    "request_id": request_id,
                    "op": "copy",
                    "ok": ok,
                    "src": src,
                    "dst": dst,
                    "error": error,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "ListDir" => {
            const MAX_DIR_PATH_CHARS: usize = 1024;
            const MAX_DIR_ENTRIES: usize = 5_000;
            const DRIVES_SENTINEL_PATH: &str = "__this_pc__";
            fn default_dir_path() -> String {
                // Prefer a real "Documents" folder; fall back safely.
                if let Some(p) = dirs::document_dir() {
                    return p.to_string_lossy().to_string();
                }
                if let Ok(up) = std::env::var("USERPROFILE") {
                    let up = up.trim();
                    if !up.is_empty() {
                        return format!("{up}\\Documents");
                    }
                }
                "C:\\".to_string()
            }

            let path_in = val["path"].as_str().unwrap_or("").trim();
            // Empty path => initial landing (Documents). Special sentinel => list drives.
            let is_drives = path_in.eq_ignore_ascii_case(DRIVES_SENTINEL_PATH);
            let path = if is_drives {
                DRIVES_SENTINEL_PATH.to_string()
            } else if path_in.is_empty() {
                default_dir_path()
            } else {
                path_in.chars().take(MAX_DIR_PATH_CHARS).collect::<String>()
            };
            let out = out_tx.clone();
            tokio::spawn(async move {
                let mut items = Vec::new();
                if is_drives {
                    #[cfg(target_os = "windows")]
                    {
                        use windows::Win32::Storage::FileSystem::GetLogicalDrives;
                        let mask = unsafe { GetLogicalDrives() };
                        // Bits 0..25 correspond to A..Z.
                        for i in 0..26u32 {
                            if (mask & (1u32 << i)) != 0 {
                                let letter = (b'A' + (i as u8)) as char;
                                let name = format!("{letter}:\\");
                                items.push(serde_json::json!({
                                    "name": name,
                                    "is_dir": true,
                                    "size": 0
                                }));
                            }
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        // Non-Windows builds aren't expected for this agent.
                    }
                } else if let Ok(mut entries) = tokio::fs::read_dir(&path).await {
                    let mut n = 0usize;
                    while let Ok(Some(entry)) = entries.next_entry().await {
                        n += 1;
                        if n > MAX_DIR_ENTRIES {
                            break;
                        }
                        let name = entry.file_name().to_string_lossy().to_string();
                        let meta = entry.metadata().await.ok();
                        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        items.push(serde_json::json!({
                            "name": name,
                            "is_dir": is_dir,
                            "size": size
                        }));
                    }
                }
                items.sort_by(|a, b| {
                    let a_dir = a["is_dir"].as_bool().unwrap_or(false);
                    let b_dir = b["is_dir"].as_bool().unwrap_or(false);
                    if a_dir != b_dir {
                        b_dir.cmp(&a_dir)
                    } else {
                        let na = a["name"].as_str().unwrap_or("");
                        let nb = b["name"].as_str().unwrap_or("");
                        software_inventory::cmp_str_ascii_case_insensitive(na, nb)
                    }
                });
                let payload = serde_json::json!({
                    "type": "dir_list",
                    "path": path,
                    "items": items
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "CollectSoftware" => {
            let out = out_tx.clone();
            tokio::spawn(async move {
                software_inventory::send_inventory(out).await;
            });
            info!("CollectSoftware scheduled.");
        }
        "RunScript" => {
            let request_id = val["request_id"].as_str().unwrap_or("").to_string();
            if request_id.is_empty() {
                warn!("RunScript missing request_id");
                return;
            }
            let shell = val["shell"].as_str().unwrap_or("powershell").to_lowercase();
            let script = val["script"].as_str().unwrap_or("").to_string();
            if script.len() > 256 * 1024 {
                warn!("RunScript rejected: script too large");
                return;
            }
            let timeout_secs = val["timeout_secs"].as_u64().unwrap_or(120).clamp(5, 300);
            let out = out_tx.clone();
            tokio::spawn(async move {
                let r = remote_script::run(&shell, &script, timeout_secs).await;
                let payload = serde_json::json!({
                    "type": "script_result",
                    "request_id": request_id,
                    "ok": r.ok,
                    "exit_code": r.exit_code,
                    "stdout": r.stdout,
                    "stderr": r.stderr,
                    "error": r.error,
                })
                .to_string();
                let _ = out.send(Message::Text(payload)).await;
            });
        }
        "ReadFile" => {
            const MAX_FILE_PATH_CHARS: usize = 2048;
            let path = val["path"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_FILE_PATH_CHARS)
                .collect::<String>();
            let out = out_tx.clone();
            tokio::spawn(async move {
                use base64::{engine::general_purpose, Engine as _};
                use tokio::io::AsyncReadExt;

                let meta = match tokio::fs::metadata(&path).await {
                    Ok(m) => m,
                    Err(e) => {
                        let payload = serde_json::json!({
                            "type": "file_chunk",
                            "path": path,
                            "data": e.to_string(),
                            "chunk_index": 0,
                            "total_chunks": 1,
                            "is_error": true
                        })
                        .to_string();
                        let _ = out.send(Message::Text(payload)).await;
                        return;
                    }
                };
                let file_len = meta.len();

                let mut f = match tokio::fs::File::open(&path).await {
                    Ok(f) => f,
                    Err(e) => {
                        let payload = serde_json::json!({
                            "type": "file_chunk",
                            "path": path,
                            "data": e.to_string(),
                            "chunk_index": 0,
                            "total_chunks": 1,
                            "is_error": true
                        })
                        .to_string();
                        let _ = out.send(Message::Text(payload)).await;
                        return;
                    }
                };

                let total_chunks = if file_len == 0 {
                    1usize
                } else {
                    (file_len as usize).div_ceil(REMOTE_FILE_CHUNK_BYTES)
                };

                if file_len == 0 {
                    let payload = serde_json::json!({
                        "type": "file_chunk",
                        "path": path,
                        "data": "",
                        "chunk_index": 0,
                        "total_chunks": 1,
                        "is_error": false
                    })
                    .to_string();
                    let _ = out.send(Message::Text(payload)).await;
                    return;
                }

                let mut idx: usize = 0;
                let mut buf = vec![0u8; REMOTE_FILE_CHUNK_BYTES];
                loop {
                    let n = match f.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(e) => {
                            let payload = serde_json::json!({
                                "type": "file_chunk",
                                "path": path,
                                "data": e.to_string(),
                                "chunk_index": idx,
                                "total_chunks": total_chunks,
                                "is_error": true
                            })
                            .to_string();
                            let _ = out.send(Message::Text(payload)).await;
                            return;
                        }
                    };
                    let data = general_purpose::STANDARD.encode(&buf[..n]);
                    let payload = serde_json::json!({
                        "type": "file_chunk",
                        "path": path,
                        "data": data,
                        "chunk_index": idx,
                        "total_chunks": total_chunks,
                        "is_error": false
                    })
                    .to_string();
                    let _ = out.send(Message::Text(payload)).await;
                    idx += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                }
            });
        }
        "WriteFileChunk" => {
            const MAX_FILE_PATH_CHARS: usize = 2048;
            use base64::{engine::general_purpose, Engine as _};
            use std::io::Write;

            let path: String = val["path"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_FILE_PATH_CHARS)
                .collect();
            let total_chunks = val["total_chunks"].as_u64().unwrap_or(0) as usize;
            let chunk_index = val["chunk_index"].as_u64().unwrap_or(0) as usize;
            let data_b64 = val["data"].as_str().unwrap_or("");

            let push_result =
                |path_s: String, ok: bool, err: String, out: mpsc::Sender<Message>| {
                    let payload = serde_json::json!({
                        "type": "file_upload_result",
                        "path": path_s,
                        "ok": ok,
                        "error": err,
                    })
                    .to_string();
                    tokio::spawn(async move {
                        let _ = out.send(Message::Text(payload)).await;
                    });
                };

            if path.is_empty() || total_chunks == 0 || chunk_index >= total_chunks {
                push_result(
                    path,
                    false,
                    "invalid upload parameters".to_string(),
                    out_tx.clone(),
                );
                return;
            }

            let decoded = match general_purpose::STANDARD.decode(data_b64) {
                Ok(b) => b,
                Err(e) => {
                    let mut g = FILE_UPLOAD_SESSION.lock().unwrap();
                    *g = None;
                    push_result(
                        path,
                        false,
                        format!("base64 decode: {e}"),
                        out_tx.clone(),
                    );
                    return;
                }
            };

            let mut g = FILE_UPLOAD_SESSION.lock().unwrap();
            if chunk_index == 0 {
                *g = Some(FileUploadSession {
                    path: path.clone(),
                    next_expected_chunk: 0,
                    total_chunks,
                    bytes_written: 0,
                });
            }
            let session = match g.as_mut() {
                Some(s) => s,
                None => {
                    drop(g);
                    push_result(
                        path,
                        false,
                        "missing upload session; send chunk 0 first".to_string(),
                        out_tx.clone(),
                    );
                    return;
                }
            };
            if session.path != path
                || session.next_expected_chunk != chunk_index
                || session.total_chunks != total_chunks
            {
                *g = None;
                drop(g);
                push_result(
                    path,
                    false,
                    "upload chunk out of sequence or path mismatch".to_string(),
                    out_tx.clone(),
                );
                return;
            }

            let new_total = session.bytes_written.saturating_add(decoded.len() as u64);

            let write_res = (|| {
                if chunk_index == 0 {
                    let mut f = std::fs::OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(&path)?;
                    f.write_all(&decoded)?;
                    f.sync_all()?;
                } else {
                    let mut f = std::fs::OpenOptions::new().append(true).open(&path)?;
                    f.write_all(&decoded)?;
                    f.sync_all()?;
                }
                Ok::<(), std::io::Error>(())
            })();

            if let Err(e) = write_res {
                *g = None;
                drop(g);
                push_result(path, false, e.to_string(), out_tx.clone());
                return;
            }

            session.bytes_written = new_total;
            session.next_expected_chunk = chunk_index + 1;
            let done = chunk_index + 1 == total_chunks;
            if done {
                *g = None;
            }
            drop(g);

            if done {
                push_result(path, true, String::new(), out_tx.clone());
            }
        }
        _ => {
            if let Err(e) = controller.handle_command(text) {
                warn!("Control command error: {e:#}");
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Build the full WebSocket URL, appending `?name=<agent_name>` and (optionally)
/// `&secret=<agent_password>` for server-side agent authentication.
fn build_ws_url(cfg: &Config) -> String {
    let base = cfg.server_url.trim_end_matches('/');
    let mut url = base.to_string();

    // Percent-encode query values so `name`/`secret` cannot inject additional
    // parameters (e.g. via `&x=y`) and so auth secrets are transmitted verbatim.
    // This also avoids accidental breakage when values contain spaces or `+`.
    fn enc(v: &str) -> String {
        use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
        // Encode everything except a conservative unreserved set.
        const SAFE: &AsciiSet = &CONTROLS
            .add(b' ')
            .add(b'"')
            .add(b'#')
            .add(b'%')
            .add(b'&')
            .add(b'+')
            .add(b',')
            .add(b'/')
            .add(b':')
            .add(b';')
            .add(b'<')
            .add(b'=')
            .add(b'>')
            .add(b'?')
            .add(b'@')
            .add(b'\\')
            .add(b'|')
            .add(b'[')
            .add(b']')
            .add(b'{')
            .add(b'}');
        utf8_percent_encode(v, SAFE).to_string()
    }
    let mut first_param = !url.contains('?');

    if !cfg.agent_name.is_empty() {
        url.push(if first_param { '?' } else { '&' });
        first_param = false;
        url.push_str("name=");
        url.push_str(&enc(cfg.agent_name.trim()));
    }

    if !cfg.agent_password.is_empty() {
        url.push(if first_param { '?' } else { '&' });
        url.push_str("secret=");
        url.push_str(&enc(cfg.agent_password.trim()));
    }

    url
}

/// Redact `secret=...` query parameter so agent secrets don't leak via logs,
/// proxies, or crash reports.
fn redact_secret_from_ws_url(url: &str) -> String {
    let Some(secret_start) = url.find("secret=") else {
        return url.to_string();
    };

    let mut out = url.to_string();
    let value_start = secret_start + "secret=".len();
    if value_start >= out.len() {
        return out;
    }

    let value_end = out[value_start..]
        .find('&')
        .map(|i| value_start + i)
        .unwrap_or(out.len());

    out.replace_range(value_start..value_end, "***");
    out
}

/// Write to the shared status mutex, ignoring lock-poison errors.
fn set_status(status: &Mutex<AgentStatus>, s: AgentStatus) {
    if let Ok(mut guard) = status.lock() {
        *guard = s;
    }
}

#[inline]
pub(crate) fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
