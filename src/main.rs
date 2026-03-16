//! # Windows Monitoring Agent
//!
//! Connects to a remote WebSocket server and:
//!
//! | Direction | Data                                   | WS frame type |
//! |-----------|----------------------------------------|---------------|
//! | Outbound  | JPEG-encoded screen frames (≤ 15 fps)  | `Binary`      |
//! | Outbound  | Active browser URL (every 2 s)         | `Text` (JSON) |
//! | Inbound   | Mouse control commands                 | `Text` (JSON) |
//!
//! ## Architecture
//!
//! ```text
//!  ┌──────────────┐   Vec<u8>   ┌──────────────────────────────────────────┐
//!  │ capture      │ ──────────► │                                          │
//!  │ (OS thread)  │  mpsc(4)    │   run_session  (Tokio task)              │
//!  └──────────────┘             │                                          │
//!                               │  tokio::select!                          │
//!  ┌──────────────┐  Message    │   ├─ frame_ticker   → Binary WS frame   │
//!  │ WS writer    │ ◄────────── │   ├─ url_ticker     → Text  WS frame    │
//!  │ (Tokio task) │  mpsc(16)   │   └─ ws_rx.next()  → InputController   │
//!  └──────────────┘             │                                          │
//!                               └──────────────────────────────────────────┘
//! ```
//!
//! ## Environment variables
//!
//! | Variable | Default              | Description             |
//! |----------|----------------------|-------------------------|
//! | `WS_URL` | `ws://127.0.0.1:9000`| Remote WebSocket server |
//! | `RUST_LOG`| `info`              | Log filter string       |

mod capture;
mod input;
mod url_scraper;
mod window_tracker;

use std::time::Duration;

use anyhow::{Context, Result};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use input::InputController;
use tokio::sync::mpsc;
use window_tracker::WindowTracker;
use tokio::time::{interval, MissedTickBehavior};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        protocol::frame::coding::CloseCode, protocol::CloseFrame, Message,
    },
    MaybeTlsStream, WebSocketStream,
};
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum frames to deliver per second.  The capture thread can produce
/// frames faster; excess frames are silently dropped so the channel never
/// blocks.
const TARGET_FPS: u64 = 15;
const FRAME_INTERVAL_MS: u64 = 1_000 / TARGET_FPS; // ≈ 66 ms

/// How long to wait before attempting a reconnect after a failed session.
const RECONNECT_DELAY_SECS: u64 = 5;

/// Bounded capacity for the JPEG frame channel.
/// Small so stale frames are evicted quickly when the consumer is slow.
const FRAME_CHANNEL_CAP: usize = 4;

/// Bounded capacity for the outbound WebSocket message channel.
const OUTBOUND_CHANNEL_CAP: usize = 16;

/// How often to poll the foreground window for title/app changes.
/// 200 ms gives sub-quarter-second detection latency with negligible CPU cost.
const WINDOW_POLL_INTERVAL_MS: u64 = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // ── Structured logging ────────────────────────────────────────────────
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .with_thread_ids(false)
        .compact()
        .init();

    // ── Configuration ─────────────────────────────────────────────────────
    // `WS_URL` is *optional*.  When absent the agent runs in console-print
    // mode so you can verify data collection without needing a server.
    let ws_url = std::env::var("WS_URL").ok();

    info!("Windows monitoring agent v{}", env!("CARGO_PKG_VERSION"));
    info!("Window poll interval  : {}ms", WINDOW_POLL_INTERVAL_MS);

    match ws_url {
        // ── Console-only mode (no server) ─────────────────────────────────
        None => {
            info!("WS_URL not set → running in CONSOLE mode (Ctrl-C to exit).");
            info!("──────────────────────────────────────────────────────────");
            run_console_mode().await;
        }

        // ── WebSocket mode ────────────────────────────────────────────────
        Some(url) => {
            info!("WebSocket endpoint    : {url}");
            info!("Target FPS            : {TARGET_FPS}");

            // The frame channel is created once and reused across reconnects
            // so the capture OS thread never stalls.
            let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>(FRAME_CHANNEL_CAP);
            capture::start_capture(frame_tx)
                .context("Failed to start screen capture")?;
            info!("Screen capture initialised on dedicated OS thread.");

            run_reconnect_loop(&url, frame_rx).await;
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Console mode  (no WebSocket server required)
// ─────────────────────────────────────────────────────────────────────────────

/// Run a local print loop – useful while developing without a server.
///
/// Prints a line to stdout whenever:
/// - The foreground window title or executable changes (≤ 200 ms latency).
/// - The active browser URL changes (checked every 2 s).
///
/// Screen capture is intentionally **disabled** in this mode; it is only
/// useful once the WebSocket transport is in place.
async fn run_console_mode() {
    let mut win_tracker  = WindowTracker::new();
    let mut last_url     = String::new();

    let mut window_ticker = interval(Duration::from_millis(WINDOW_POLL_INTERVAL_MS));
    let mut url_ticker    = interval(Duration::from_secs(2));

    window_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    url_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;

            // ── Window / tab title ─────────────────────────────────────────
            _ = window_ticker.tick() => {
                if let Some(event) = win_tracker.poll() {
                    let app   = if event.app.is_empty()   { "—".to_string() } else { event.app.clone() };
                    let title = if event.title.is_empty() { "(desktop)".to_string() } else { event.title.clone() };
                    println!("[WINDOW] app={app:<20}  title={title}");
                }
            }

            // ── Browser URL ────────────────────────────────────────────────
            _ = url_ticker.tick() => {
                if let Some(url) = url_scraper::get_active_url() {
                    // Only print when the URL actually changes.
                    if url != last_url {
                        println!("[URL]    {url}");
                        last_url = url;
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnect loop
// ─────────────────────────────────────────────────────────────────────────────

/// Attempt to connect to `ws_url` and run a session; reconnect on any
/// failure.  This function never returns under normal operation.
async fn run_reconnect_loop(ws_url: &str, mut frame_rx: mpsc::Receiver<Vec<u8>>) {
    loop {
        info!("Connecting to {ws_url} …");

        match connect_async(ws_url).await {
            Ok((ws_stream, response)) => {
                info!(
                    "WebSocket connected (HTTP {}).",
                    response.status().as_u16()
                );
                match run_session(ws_stream, &mut frame_rx).await {
                    Ok(()) => info!("Session closed gracefully."),
                    Err(e) => error!("Session terminated with error: {e:#}"),
                }
            }
            Err(e) => {
                error!("Connection failed: {e}");
            }
        }

        info!("Reconnecting in {RECONNECT_DELAY_SECS}s …");
        tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)).await;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session driver
// ─────────────────────────────────────────────────────────────────────────────

/// Drive a single active WebSocket session until it closes or errors.
///
/// # Concurrency model
///
/// ```text
///  frame_rx ──(try_recv)──┐
///  url_ticker             │
///  window_ticker ─────────┼── tokio::select! ──► out_tx ──► writer task ──► ws_tx
///  ws_rx (inbound cmds) ──┘                                 (serialised writes)
/// ```
///
/// The *writer task* owns the `SinkExt` write half of the socket; all other
/// producers enqueue [`Message`]s on `out_tx` so there is a single writer
/// and no `Mutex` is needed.
async fn run_session(
    ws_stream: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    frame_rx: &mut mpsc::Receiver<Vec<u8>>,
) -> Result<()> {
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // ── Outbound message bus ──────────────────────────────────────────────
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(OUTBOUND_CHANNEL_CAP);

    // Writer task: serialises all outbound messages into the WS sink.
    // Exits when `out_tx` is dropped (signalling end of session).
    let writer_handle = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if let Err(e) = ws_tx.send(msg).await {
                // A closed socket is the normal "server went away" case.
                warn!("WS write error (writer exiting): {e}");
                break;
            }
        }
        // Best-effort graceful close; ignore errors (socket may already be gone).
        let _ = ws_tx
            .send(Message::Close(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "agent shutting down".into(),
            })))
            .await;
        let _ = ws_tx.close().await;
    });

    // ── Input controller ──────────────────────────────────────────────────
    let mut controller =
        InputController::new().context("Failed to create input controller")?;

    // ── Window focus tracker ──────────────────────────────────────────────
    let mut win_tracker = WindowTracker::new();

    // ── Timers ────────────────────────────────────────────────────────────
    let mut frame_ticker  = interval(Duration::from_millis(FRAME_INTERVAL_MS));
    let mut url_ticker    = interval(Duration::from_secs(2));
    let mut window_ticker = interval(Duration::from_millis(WINDOW_POLL_INTERVAL_MS));

    // `Skip`: if we fall behind, resume at current time rather than firing
    // a burst of ticks to "catch up".
    frame_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    url_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    window_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    // ── Event loop ────────────────────────────────────────────────────────
    let result: Result<()> = loop {
        tokio::select! {
            biased; // Poll branches in declaration order to give WS reads priority.

            // ── Branch 1: inbound WebSocket messages ──────────────────────
            //
            // The server sends JSON text frames containing mouse-control
            // commands.  Any other frame type is silently ignored.
            msg = ws_rx.next() => {
                match msg {
                    // ── Control command ────────────────────────────────────
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = controller.handle_command(&text) {
                            // Log and continue – a bad command must not drop
                            // the session.
                            warn!("Control command error: {e:#}");
                        }
                    }

                    // ── Server-initiated close ─────────────────────────────
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .as_ref()
                            .map(|f| f.reason.as_ref())
                            .unwrap_or("no reason");
                        info!("Server sent Close frame: {reason}");
                        break Ok(());
                    }

                    // ── Ping (auto-handled by tungstenite) ─────────────────
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}

                    // ── Unexpected binary from server ──────────────────────
                    Some(Ok(_)) => {}

                    // ── Transport error ────────────────────────────────────
                    Some(Err(e)) => {
                        break Err(anyhow::anyhow!("WS receive error: {e}"));
                    }

                    // ── Stream exhausted (connection dropped) ──────────────
                    None => {
                        info!("WebSocket stream ended.");
                        break Ok(());
                    }
                }
            }

            // ── Branch 2: screen capture frame delivery ───────────────────
            //
            // Tick at `TARGET_FPS`.  On each tick drain the frame channel
            // to the *latest* available frame, discarding any intermediate
            // ones so the client always sees fresh content.
            _ = frame_ticker.tick() => {
                let mut latest: Option<Vec<u8>> = None;
                while let Ok(jpeg) = frame_rx.try_recv() {
                    latest = Some(jpeg);
                }

                if let Some(jpeg) = latest {
                    // tungstenite >= 0.21 expects `Bytes` for Binary frames.
                    // If you're on an older version, change to:
                    //   Message::Binary(jpeg)
                    let msg = Message::Binary(Bytes::from(jpeg));
                    if out_tx.send(msg).await.is_err() {
                        break Err(anyhow::anyhow!(
                            "Outbound channel closed; writer task exited unexpectedly."
                        ));
                    }
                }
            }

            // ── Branch 3: active browser URL ──────────────────────────────
            //
            // Poll every 2 seconds.  `get_active_url` is a fast synchronous
            // Windows UI-Automation call; no `spawn_blocking` is needed.
            _ = url_ticker.tick() => {
                if let Some(url) = url_scraper::get_active_url() {
                    let payload = serde_json::json!({
                        "type": "url",
                        "url":  url,
                        "ts":   unix_timestamp_secs(),
                    })
                    .to_string();

                    if out_tx.send(Message::Text(payload)).await.is_err() {
                        break Err(anyhow::anyhow!(
                            "Outbound channel closed; writer task exited unexpectedly."
                        ));
                    }
                }
            }

            // ── Branch 4: foreground window / tab changes ─────────────────
            //
            // Polls `GetForegroundWindow` + `GetWindowTextW` every
            // WINDOW_POLL_INTERVAL_MS.  Only emits an event when the HWND
            // or the window title actually changes, so Chrome tab switches,
            // Alt-Tab transitions, and page-title updates are all captured
            // without flooding the server with identical messages.
            _ = window_ticker.tick() => {
                if let Some(event) = win_tracker.poll() {
                    let payload = serde_json::json!({
                        "type"  : "window_focus",
                        // Full window title: e.g. "Rust docs – Google Chrome"
                        "title" : event.title,
                        // Executable basename: e.g. "chrome.exe", "Code.exe"
                        "app"   : event.app,
                        // Raw HWND for server-side correlation.
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
        }
    };

    // ── Shutdown ──────────────────────────────────────────────────────────
    //
    // Drop the sender so the writer task's `recv()` loop sees `None` and
    // exits cleanly, then await it to ensure the socket is flushed/closed.
    drop(out_tx);
    if let Err(e) = writer_handle.await {
        warn!("Writer task panicked: {e}");
    }

    result
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Return the current time as UNIX seconds (UTC).
#[inline]
fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
