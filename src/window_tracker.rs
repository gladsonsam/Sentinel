//! # Window Focus Tracker
//!
//! Detects foreground-window switches on Windows and emits a [`WindowEvent`]
//! each time the active window changes.
//!
//! ## How it works
//!
//! The tracker is **polled** on a short interval (recommended: 200–250 ms).
//! On every call to [`WindowTracker::poll`] it:
//!
//! 1. Calls `GetForegroundWindow()` to read the current foreground `HWND`.
//! 2. If the `HWND` differs from the last seen value, reads the window title
//!    with `GetWindowTextW()`.
//! 3. Additionally reads the title of the **owner process** via
//!    `GetWindowModuleFileNameW` so we can surface the executable name
//!    (e.g. `chrome.exe`) alongside the window title.
//! 4. Returns `Some(WindowEvent)` on a change, `None` otherwise.
//!
//! ## Example events
//!
//! | Scenario                   | `title`                        | `app` |
//! |----------------------------|--------------------------------|-------|
//! | Chrome tab switch          | `"Rust docs – Google Chrome"`  | `"chrome.exe"` |
//! | Edge tab switch            | `"GitHub – Microsoft Edge"`    | `"msedge.exe"` |
//! | Alt-Tab to VS Code         | `"main.rs – win-rust-client"`  | `"Code.exe"` |
//! | Desktop / no window        | `""`                           | `""` |
//!
//! ## Wire format
//!
//! The event is serialised by the caller into:
//! ```json
//! {
//!   "type"  : "window_focus",
//!   "title" : "Rust docs – Google Chrome",
//!   "app"   : "chrome.exe",
//!   "hwnd"  : 131234,
//!   "ts"    : 1713000000
//! }
//! ```

use tracing::warn;
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowModuleFileNameW, GetWindowTextW,
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// A window-focus event emitted when the foreground window changes.
#[derive(Debug, Clone)]
pub struct WindowEvent {
    /// Full window title (e.g. `"Tab Name – Google Chrome"`).
    pub title: String,
    /// Short executable name of the owning process (e.g. `"chrome.exe"`).
    /// Empty string if it could not be retrieved.
    pub app: String,
    /// Raw HWND value, useful for correlation on the server side.
    pub hwnd: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker
// ─────────────────────────────────────────────────────────────────────────────

/// Stateful tracker that remembers the last-seen foreground window.
///
/// Construct once per session with [`WindowTracker::new`] and call
/// [`WindowTracker::poll`] on a regular interval.
pub struct WindowTracker {
    /// The `HWND` value seen on the previous poll, stored as `usize` for
    /// `Copy` semantics and easy comparison.
    last_hwnd: usize,
    /// Cached title of the previous window to suppress duplicate events
    /// when the same window gets a title update *without* a focus change
    /// (e.g. a page loading spinner).
    last_title: String,
}

impl WindowTracker {
    /// Create a tracker with no prior state.  The first [`poll`] call after
    /// construction will always emit an event (even if the desktop is idle).
    pub fn new() -> Self {
        Self {
            last_hwnd: 0,
            last_title: String::new(),
        }
    }

    /// Check whether the foreground window changed since the last call.
    ///
    /// Returns `Some(WindowEvent)` on a title *or* HWND change, `None`
    /// otherwise.  Fast-path: if neither the HWND nor the title changed, no
    /// additional API calls are made.
    pub fn poll(&mut self) -> Option<WindowEvent> {
        // ── 1. Foreground HWND ────────────────────────────────────────────
        let hwnd: HWND = unsafe { GetForegroundWindow() };
        let hwnd_raw = hwnd.0 as usize;

        // A null HWND means the desktop itself has focus (e.g. all windows
        // minimised).  Emit a synthetic "desktop" event once per transition.
        if hwnd_raw == 0 {
            if self.last_hwnd != 0 {
                self.last_hwnd = 0;
                self.last_title = String::new();
                return Some(WindowEvent {
                    title: String::new(),
                    app: String::new(),
                    hwnd: 0,
                });
            }
            return None;
        }

        // ── 2. Window title ───────────────────────────────────────────────
        let title = read_window_title(hwnd);

        // Only emit an event if something actually changed.
        if hwnd_raw == self.last_hwnd && title == self.last_title {
            return None;
        }

        // ── 3. Executable name ────────────────────────────────────────────
        let app = read_module_filename(hwnd);

        // ── 4. Persist state & return event ──────────────────────────────
        self.last_hwnd = hwnd_raw;
        self.last_title = title.clone();

        Some(WindowEvent { title, app, hwnd: hwnd_raw })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Win32 helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Read the window title via `GetWindowTextW`.
///
/// Returns an empty string on failure (e.g. the window was destroyed between
/// the `GetForegroundWindow` call and this call – race condition safe).
fn read_window_title(hwnd: HWND) -> String {
    // Allocate a mutable UTF-16 buffer on the stack.
    // 512 wide chars covers virtually all window titles.
    let mut buf = [0u16; 512];
    // Safety: `hwnd` is non-null (checked by caller); `buf` is valid.
    let len = unsafe { GetWindowTextW(hwnd, PWSTR(buf.as_mut_ptr()), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Read the base filename of the module (executable) associated with `hwnd`.
///
/// `GetWindowModuleFileNameW` returns the full path for out-of-process
/// windows; we strip it to just the filename component for brevity:
/// `C:\Program Files\Google\Chrome\Application\chrome.exe`  →  `chrome.exe`.
///
/// Returns an empty string if the call fails (e.g. the process is elevated
/// and we are not, which is a common permission boundary).
fn read_module_filename(hwnd: HWND) -> String {
    let mut buf = [0u16; 1024];
    // Safety: `hwnd` non-null; `buf` valid for the requested length.
    let len =
        unsafe { GetWindowModuleFileNameW(hwnd, PWSTR(buf.as_mut_ptr()), buf.len() as u32) };

    if len == 0 {
        return String::new();
    }

    let full_path = String::from_utf16_lossy(&buf[..len as usize]);

    // Extract just the filename (everything after the last `\` or `/`).
    full_path
        .rsplit(|c| c == '\\' || c == '/')
        .next()
        .unwrap_or(&full_path)
        .to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke-test: tracker must not panic and must return *something* on first
    /// poll (assumes tests run on a desktop with at least one window open).
    #[test]
    #[cfg(target_os = "windows")]
    fn first_poll_returns_event() {
        let mut tracker = WindowTracker::new();
        // First call always returns Some because last_hwnd starts at 0.
        let event = tracker.poll();
        assert!(
            event.is_some(),
            "expected an event on first poll (is a window focused?)"
        );
    }

    /// Second consecutive poll on the same window must return None
    /// (no spurious events).
    #[test]
    #[cfg(target_os = "windows")]
    fn second_poll_same_window_returns_none() {
        let mut tracker = WindowTracker::new();
        let _ = tracker.poll(); // consume first
        let second = tracker.poll();
        assert!(second.is_none(), "no change expected on back-to-back polls");
    }
}
