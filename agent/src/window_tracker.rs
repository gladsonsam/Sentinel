//! # Window Focus Tracker
//!
//! Detects foreground-window switches and emits a [`WindowEvent`] on every
//! title or HWND change.
//!
//! ## Why `QueryFullProcessImageNameW` instead of `GetWindowModuleFileNameW`
//!
//! `GetWindowModuleFileNameW` returns an empty string for modern packaged /
//! UWP apps (Microsoft Edge, Microsoft Store apps, etc.) because those
//! processes load through a host process that Windows doesn't expose via that
//! API.  `QueryFullProcessImageNameW` works for all processes, including
//! packaged ones, as long as we open the process with
//! `PROCESS_QUERY_LIMITED_INFORMATION` (which is granted even cross-elevation).

use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, HWND},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::Accessibility::{
            SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, EVENT_SYSTEM_FOREGROUND,
        },
    },
};

use std::sync::{Mutex, OnceLock};
use tokio::sync::mpsc;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct WindowEvent {
    /// Full window title (e.g. `"Rust docs – Google Chrome"`).
    pub title: String,
    /// Short executable name (e.g. `"msedge.exe"`, `"chrome.exe"`).
    pub app: String,
    /// Friendly executable name derived from file metadata.
    /// Example: `"Microsoft Edge"`.
    pub app_display: String,
    /// Raw HWND value for server-side correlation.
    pub hwnd: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker
// ─────────────────────────────────────────────────────────────────────────────

pub struct WindowTracker {
    last_hwnd: usize,
    last_title: String,
}

impl Default for WindowTracker {
    fn default() -> Self {
        Self {
            last_hwnd: 0,
            last_title: String::new(),
        }
    }
}

impl WindowTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the current foreground window details (no change detection).
    pub fn snapshot(&self) -> WindowEvent {
        let hwnd: HWND = unsafe { GetForegroundWindow() };
        let hwnd_raw = hwnd.0 as usize;
        if hwnd_raw == 0 {
            return WindowEvent {
                title: String::new(),
                app: String::new(),
                app_display: String::new(),
                hwnd: 0,
            };
        }
        let title = read_window_title(hwnd);
        let (app, app_display) = read_process_name(hwnd);
        WindowEvent {
            title,
            app,
            app_display,
            hwnd: hwnd_raw,
        }
    }

    /// Apply a snapshot and emit only if it changed.
    pub fn update_if_changed(&mut self, snap: WindowEvent) -> Option<WindowEvent> {
        if snap.hwnd == 0 {
            if self.last_hwnd != 0 {
                self.last_hwnd = 0;
                self.last_title = String::new();
                return Some(snap);
            }
            return None;
        }

        if snap.hwnd == self.last_hwnd && snap.title == self.last_title {
            return None;
        }

        self.last_hwnd = snap.hwnd;
        self.last_title = snap.title.clone();
        Some(snap)
    }

    /// Returns `Some(WindowEvent)` when the foreground window or its title
    /// has changed since the last call; `None` otherwise.
    pub fn poll(&mut self) -> Option<WindowEvent> {
        let snap = self.snapshot();
        self.update_if_changed(snap)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event-driven foreground notifications (low CPU)
// ─────────────────────────────────────────────────────────────────────────────

static FOREGROUND_NOTIFY_TX: OnceLock<Mutex<Option<mpsc::UnboundedSender<()>>>> = OnceLock::new();

fn notify_tx() -> &'static Mutex<Option<mpsc::UnboundedSender<()>>> {
    FOREGROUND_NOTIFY_TX.get_or_init(|| Mutex::new(None))
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if event != EVENT_SYSTEM_FOREGROUND {
        return;
    }
    if let Ok(guard) = notify_tx().lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(());
        }
    }
}

pub struct ForegroundHookGuard {
    hook: HWINEVENTHOOK,
}

impl Drop for ForegroundHookGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = UnhookWinEvent(self.hook);
        }
        if let Ok(mut guard) = notify_tx().lock() {
            *guard = None;
        }
    }
}

/// Subscribe to foreground-window-change notifications with a WinEvent hook.
///
/// This avoids constant polling and significantly lowers idle CPU usage.
pub fn subscribe_foreground_events() -> anyhow::Result<(ForegroundHookGuard, mpsc::UnboundedReceiver<()>)> {
    let (tx, rx) = mpsc::unbounded_channel::<()>();
    if let Ok(mut guard) = notify_tx().lock() {
        *guard = Some(tx);
    }

    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_proc),
            0,
            0,
            0, // WINEVENT_OUTOFCONTEXT
        )
    };

    if hook.0.is_null() {
        return Err(anyhow::anyhow!("SetWinEventHook(EVENT_SYSTEM_FOREGROUND) failed"));
    }

    Ok((ForegroundHookGuard { hook }, rx))
}

// ─────────────────────────────────────────────────────────────────────────────
// Win32 helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Read the window title via `GetWindowTextW` (slice-based API in windows 0.58).
fn read_window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Read the executable basename + friendly name using `QueryFullProcessImageNameW`.
///
/// This works for **all** process types including packaged/UWP apps like
/// Microsoft Edge, unlike `GetWindowModuleFileNameW` which returns empty
/// for those processes.
///
/// Steps:
/// 1. `GetWindowThreadProcessId` → PID
/// 2. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` → handle
/// 3. `QueryFullProcessImageNameW` → full path (e.g. `C:\...\msedge.exe`)
/// 4. Split on `\` / `/` → just the filename
fn read_process_name(hwnd: HWND) -> (String, String) {
    // ── 1. PID ───────────────────────────────────────────────────────────
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return (String::new(), String::new());
    }

    // ── 2. Process handle ────────────────────────────────────────────────
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(h) => h,
        Err(_) => return (String::new(), String::new()),
    };

    // ── 3. Full image path ───────────────────────────────────────────────
    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0), // Win32 path format (not NT native)
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
    };
    // Always close the handle, regardless of success.
    let _ = unsafe { CloseHandle(handle) };

    if result.is_err() {
        return (String::new(), String::new());
    }

    // ── 4. Strip path → basename ─────────────────────────────────────────
    let full_path = String::from_utf16_lossy(&buf[..size as usize]);
    let app = full_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_string();
    let app_display = crate::app_display::app_display_name_from_full_path(&full_path);

    (app, app_display)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn first_poll_returns_event() {
        let mut tracker = WindowTracker::new();
        assert!(tracker.poll().is_some());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn second_consecutive_poll_returns_none() {
        let mut tracker = WindowTracker::new();
        let _ = tracker.poll();
        assert!(tracker.poll().is_none());
    }
}
