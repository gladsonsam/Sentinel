#![cfg(target_os = "windows")]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result};
use tracing::{error, info, warn};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::LUID;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{
    AdjustTokenPrivileges, DuplicateTokenEx, LookupPrivilegeValueW, SecurityImpersonation,
    TokenPrimary, SE_PRIVILEGE_ENABLED, TOKEN_ACCESS_MASK, TOKEN_ADJUST_DEFAULT,
    TOKEN_ADJUST_PRIVILEGES, TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE,
    TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows::Win32::System::RemoteDesktop::{WTSGetActiveConsoleSessionId, WTSQueryUserToken};
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, CREATE_UNICODE_ENVIRONMENT, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
    STARTUPINFOW,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

const SERVICE_NAME: &str = "SentinelAgentLauncher";
const POLL_INTERVAL: Duration = Duration::from_secs(10);

windows_service::define_windows_service!(ffi_service_main, service_main);

pub fn run_windows_service() -> windows_service::Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
}

fn service_main(_arguments: Vec<std::ffi::OsString>) {
    if let Err(e) = run_service() {
        error!("Service terminated with error: {e:#}");
    }
}

fn run_service() -> windows_service::Result<()> {
    // Needed on some machines for CreateProcessAsUserW.
    if let Err(e) =
        enable_privileges(&["SeIncreaseQuotaPrivilege", "SeAssignPrimaryTokenPrivilege"])
    {
        warn!("Failed enabling service privileges: {e:#}");
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let status_handle =
        service_control_handler::register(SERVICE_NAME, move |control| match control {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                info!("Service stop requested ({:?}).", control);
                let _ = stop_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        })?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    info!("Service started; waiting for user sessions.");
    let mut launched_for_session: Option<u32> = None;

    loop {
        match stop_rx.recv_timeout(POLL_INTERVAL) {
            Ok(()) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Service stop channel disconnected; continuing.");
            }
        }

        let active_session = unsafe { WTSGetActiveConsoleSessionId() };
        if active_session == u32::MAX {
            launched_for_session = None;
            continue;
        }

        if launched_for_session == Some(active_session) {
            continue;
        }

        match launch_user_agent_in_session(active_session) {
            Ok(()) => {
                launched_for_session = Some(active_session);
                info!("Launched agent process in user session {active_session}.");
            }
            Err(e) => {
                warn!("Failed launching agent in session {active_session}: {e:#}");
            }
        }
    }

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    info!("Service stopped.");
    Ok(())
}

fn launch_user_agent_in_session(session_id: u32) -> Result<()> {
    let mut impersonation_token = HANDLE::default();
    unsafe { WTSQueryUserToken(session_id, &mut impersonation_token) }
        .ok()
        .context("WTSQueryUserToken failed")?;

    let mut primary_token = HANDLE::default();
    let access: TOKEN_ACCESS_MASK = TOKEN_ASSIGN_PRIMARY
        | TOKEN_DUPLICATE
        | TOKEN_QUERY
        | TOKEN_ADJUST_DEFAULT
        | TOKEN_ADJUST_SESSIONID
        | TOKEN_ADJUST_PRIVILEGES;
    unsafe {
        DuplicateTokenEx(
            impersonation_token,
            access,
            None,
            SecurityImpersonation,
            TokenPrimary,
            &mut primary_token,
        )
    }
    .ok()
    .context("DuplicateTokenEx failed")?;

    let creation_flags: PROCESS_CREATION_FLAGS = CREATE_UNICODE_ENVIRONMENT;

    let exe = std::env::current_exe().context("Cannot resolve current executable path")?;
    // Force user-agent logs into a stable location so service-started failures are visible.
    let user_log = program_data_path("user-agent.log");
    let cmdline = format!(
        "\"{}\" --log-file \"{}\"",
        exe.display(),
        user_log.display()
    );
    let mut cmdline_w = to_wide_z(&cmdline);
    let desktop_w = to_wide_z("winsta0\\default");

    let mut startup = STARTUPINFOW::default();
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.lpDesktop = PWSTR(desktop_w.as_ptr() as *mut _);

    // Critical: the user-agent relies on per-user env vars (LOCALAPPDATA) for config + WebView2.
    // When launched from LocalSystem, we must build an environment block for the target user.
    let mut env_block: *mut core::ffi::c_void = std::ptr::null_mut();
    unsafe { CreateEnvironmentBlock(&mut env_block, Some(primary_token), false) }
        .ok()
        .context("CreateEnvironmentBlock failed")?;

    let mut proc_info = PROCESS_INFORMATION::default();
    let create_result = unsafe {
        CreateProcessAsUserW(
            Some(primary_token),
            PCWSTR::null(),
            Some(PWSTR(cmdline_w.as_mut_ptr())),
            None,
            None,
            false,
            creation_flags,
            Some(env_block),
            PCWSTR::null(),
            &startup,
            &mut proc_info,
        )
    };

    let _ = unsafe { DestroyEnvironmentBlock(env_block) };

    if create_result.is_ok() {
        info!(
            "CreateProcessAsUserW succeeded (pid={}, session={}).",
            proc_info.dwProcessId, session_id
        );
    }

    let _ = unsafe { CloseHandle(proc_info.hProcess) };
    let _ = unsafe { CloseHandle(proc_info.hThread) };
    let _ = unsafe { CloseHandle(primary_token) };
    let _ = unsafe { CloseHandle(impersonation_token) };

    create_result.ok().context("CreateProcessAsUserW failed")?;
    Ok(())
}

pub(crate) fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn program_data_path(filename: &str) -> std::path::PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\ProgramData"));
    base.join("Sentinel").join(filename)
}

fn enable_privileges(names: &[&str]) -> Result<()> {
    let mut token = HANDLE::default();
    unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut token,
        )
    }
    .ok()
    .context("OpenProcessToken failed")?;

    for &name in names {
        let mut luid = LUID::default();
        let name_w = to_wide_z(name);
        unsafe { LookupPrivilegeValueW(PCWSTR::null(), PCWSTR(name_w.as_ptr()), &mut luid) }
            .ok()
            .with_context(|| format!("LookupPrivilegeValueW failed for {name}"))?;

        let mut tp = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [windows::Win32::Security::LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };

        unsafe { AdjustTokenPrivileges(token, false, Some(&mut tp), 0, None, None) }
            .ok()
            .with_context(|| format!("AdjustTokenPrivileges failed for {name}"))?;
    }

    let _ = unsafe { CloseHandle(token) };
    Ok(())
}
