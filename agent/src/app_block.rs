//! App blocking enforcement.
//!
//! The server pushes a list of `BlockRule`s via `set_app_block_rules`.
//! `run_enforcer` loops every 2 seconds, kills matching processes, and
//! reports each kill back to the server via a channel that main.rs drains
//! and forwards over the WebSocket.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::config::StoredBlockRule;

// ── Rule types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    Exact,
    Contains,
}

impl MatchMode {
    fn from_str(s: &str) -> Self {
        if s == "exact" { MatchMode::Exact } else { MatchMode::Contains }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockRule {
    pub id: i64,
    pub exe_pattern: String,
    pub match_mode: MatchMode,
}

impl BlockRule {
    pub fn from_stored(s: &StoredBlockRule) -> Self {
        BlockRule {
            id: s.id,
            exe_pattern: s.exe_pattern.clone(),
            match_mode: MatchMode::from_str(&s.match_mode),
        }
    }

    pub fn to_stored(&self) -> StoredBlockRule {
        StoredBlockRule {
            id: self.id,
            exe_pattern: self.exe_pattern.clone(),
            match_mode: match self.match_mode {
                MatchMode::Exact => "exact".into(),
                MatchMode::Contains => "contains".into(),
            },
        }
    }

    fn matches(&self, exe: &str) -> bool {
        let exe_lower = exe.to_lowercase();
        let pat = self.exe_pattern.to_lowercase();
        match self.match_mode {
            MatchMode::Exact => exe_lower == pat,
            MatchMode::Contains => exe_lower.contains(pat.as_str()),
        }
    }
}

// ── Kill event reported back to server ───────────────────────────────────────

#[derive(Debug, Clone)]
pub struct KillEvent {
    pub rule_id: i64,
    pub rule_name: String,
    pub exe_name: String,
}

// ── Shared state ──────────────────────────────────────────────────────────────

pub type SharedRules = Arc<Mutex<Vec<BlockRule>>>;

/// Holds the sender side of the kill-report channel; set/cleared each session.
pub type KillReportTx = Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<KillEvent>>>>;

pub fn new_shared_rules() -> SharedRules {
    Arc::new(Mutex::new(Vec::new()))
}

pub fn new_kill_report_tx() -> KillReportTx {
    Arc::new(Mutex::new(None))
}

// ── Enforcer loop ─────────────────────────────────────────────────────────────

pub async fn run_enforcer(rules: SharedRules, kill_tx: KillReportTx) {
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let active: Vec<BlockRule> = {
            let lock = rules.lock().unwrap();
            if lock.is_empty() {
                continue;
            }
            lock.clone()
        };
        let kills = kill_matching_processes(&active);
        if !kills.is_empty() {
            let sender = kill_tx.lock().unwrap().clone();
            if let Some(tx) = sender {
                for ev in kills {
                    let _ = tx.send(ev);
                }
            }
        }
    }
}

// ── Windows: process enumeration + kill ───────────────────────────────────────

#[cfg(windows)]
fn kill_matching_processes(rules: &[BlockRule]) -> Vec<KillEvent> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };

    let snap = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(h) => h,
        Err(e) => {
            warn!("App block: CreateToolhelp32Snapshot failed: {e}");
            return Vec::new();
        }
    };

    let self_pid = unsafe { GetCurrentProcessId() };
    let mut killed = Vec::new();

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut result = unsafe { Process32FirstW(snap, &mut entry) };
    while result.is_ok() {
        let len = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        let exe = String::from_utf16_lossy(&entry.szExeFile[..len]);
        let pid = entry.th32ProcessID;

        if pid != self_pid && pid != 0 && pid != 4 {
            if let Some(rule) = rules.iter().find(|r| r.matches(&exe)) {
                match unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) } {
                    Ok(handle) => {
                        if unsafe { TerminateProcess(handle, 1) }.is_ok() {
                            info!("App block: killed '{}' (pid {}) — rule #{}", exe, pid, rule.id);
                            killed.push(KillEvent {
                                rule_id: rule.id,
                                rule_name: rule.exe_pattern.clone(),
                                exe_name: exe.clone(),
                            });
                        }
                        let _ = unsafe { CloseHandle(handle) };
                    }
                    Err(_) => {}
                }
            }
        }

        result = unsafe { Process32NextW(snap, &mut entry) };
    }

    let _ = unsafe { CloseHandle(snap) };
    killed
}

#[cfg(not(windows))]
fn kill_matching_processes(_rules: &[BlockRule]) -> Vec<KillEvent> {
    Vec::new()
}
