/**
 * Sentinel Agent – Settings Webview
 *
 * Communicates with the Rust backend through Tauri's IPC `invoke()` API.
 *
 * Commands exposed by Rust:
 *   get_config()  -> Config
 *   save_config(config: Config) -> void
 *   get_status()  -> { status: "Connected"|"Connecting"|"Disconnected"|"Error", message?: string }
 *   exit_agent()  -> never
 *   hide_window() -> void
 *   check_manual_update() -> { update_available, published_version?, running_version }
 *   apply_manual_update() -> { outcome: "up_to_date" | "install_started" }
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import {
  Save,
  X,
  Power,
  Lock,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Loader2,
  Settings,
  AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentConfig {
  server_url: string;
  agent_name: string;
  agent_password: string;
  ui_password_hash: string;
  auto_update_enabled: boolean;
}

type ConnectionStatus = "Connected" | "Connecting" | "Disconnected" | "Error";

interface StatusResponse {
  status: ConnectionStatus;
  message?: string;
}

interface ManualUpdateCheckResponse {
  update_available: boolean;
  published_version?: string;
  running_version: string;
}

interface ManualApplyUpdateResponse {
  outcome: string;
}

type UpdateDialogState =
  | null
  | { phase: "checking" }
  | { phase: "uptodate" }
  | { phase: "available"; publishedVersion: string }
  | { phase: "error"; message: string }
  | { phase: "installing" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  message,
  className = "",
}: {
  status: ConnectionStatus;
  message?: string;
  className?: string;
}) {
  const configs: Record<ConnectionStatus, { color: string; icon: React.ReactNode; label: string }> = {
    Connected: {
      color: "text-ok",
      icon: <Wifi size={12} />,
      label: "Connected",
    },
    Connecting: {
      color: "text-warn",
      icon: <Loader2 size={12} className="animate-spin" />,
      label: "Connecting…",
    },
    Disconnected: {
      color: "text-muted",
      icon: <WifiOff size={12} />,
      label: "Disconnected",
    },
    Error: {
      color: "text-danger",
      icon: <AlertTriangle size={12} />,
      label: message ? `Error: ${message}` : "Error",
    },
  };

  const cfg = configs[status];

  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${cfg.color} ${className}`.trim()}>
      {cfg.icon}
      <span className="truncate max-w-[180px]">{cfg.label}</span>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-primary block mb-1.5">
      {children}
    </label>
  );
}

function FormGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1 mb-4">{children}</div>;
}

// ── Password Gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setChecking(true);
    try {
      await invoke("verify_ui_password", { password: pw });
      setError(false);
      onUnlock();
    } catch {
      setError(true);
      setPw("");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="sentinel-agent-auth-shell animate-fade-in">
      <div className="sentinel-agent-auth-card">
        <div className="sentinel-agent-auth-card-content">
          <div className="sentinel-agent-auth-card-brand">
            <img src="/favicon.svg" alt="" className="sentinel-agent-auth-logo" />
            <h1 className="sentinel-agent-auth-title">Sentinel</h1>
            <p className="sentinel-agent-auth-subtitle">Sign in to continue</p>
          </div>

          <p className="sentinel-agent-auth-hint">Enter the UI access password for this agent.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <PasswordInput
              id="gate-password"
              value={pw}
              onChange={setPw}
              placeholder="Password"
            />

            {error && (
              <p className="text-xs text-danger flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Wrong password — try again
              </p>
            )}

            <button type="submit" disabled={checking || !pw} className="sentinel-btn-primary w-full py-2.5">
              {checking ? "Checking…" : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel() {
  const [config, setConfig] = useState<AgentConfig>({
    server_url: "",
    agent_name: "",
    agent_password: "",
    ui_password_hash: "",
    auto_update_enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [status, setStatus] = useState<StatusResponse>({ status: "Disconnected" });
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogState>(null);

  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load config on mount ────────────────────────────────────────────────────
  useEffect(() => {
    invoke<AgentConfig>("get_config").then((cfg) => {
      setConfig(cfg);
      setLoading(false);
    });
  }, []);

  // ── Poll status every 2 s ───────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await invoke<StatusResponse>("get_status");
        setStatus(s);
      } catch {
        setStatus({ status: "Error", message: "IPC unavailable" });
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => {
    invoke<string>("get_app_version")
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(""));
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (newPw && newPw !== confirmPw) {
      setSaveMsg({ text: "Passwords don't match", ok: false });
      return;
    }
    setSaving(true);

    try {
      const payload: AgentConfig & { new_password?: string } = {
        ...config,
        ...(newPw ? { new_password: newPw } : {}),
      };
      await invoke("save_config", { config: payload });
      setSaveMsg({ text: "Settings saved ✓", ok: true });
      setNewPw("");
      setConfirmPw("");
      // Reload config so ui_password_hash is up-to-date
      const fresh = await invoke<AgentConfig>("get_config");
      setConfig(fresh);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveMsg({ text: `Save failed: ${msg}`, ok: false });
    } finally {
      setSaving(false);
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
      saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 4000);
    }
  }, [config, newPw, confirmPw]);

  const handleClose = useCallback(() => {
    invoke("hide_window").catch(() => {});
  }, []);

  const handleExit = useCallback(() => {
    invoke("exit_agent").catch(() => {});
  }, []);

  const openUpdateCheck = useCallback(async () => {
    setUpdateDialog({ phase: "checking" });
    try {
      const r = await invoke<ManualUpdateCheckResponse>("check_manual_update");
      if (r.update_available && r.published_version) {
        setUpdateDialog({ phase: "available", publishedVersion: r.published_version });
      } else {
        setUpdateDialog({ phase: "uptodate" });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setUpdateDialog({ phase: "error", message });
    }
  }, []);

  const applyManualUpdate = useCallback(async () => {
    setUpdateDialog({ phase: "installing" });
    try {
      const r = await invoke<ManualApplyUpdateResponse>("apply_manual_update");
      if (r.outcome === "install_started") {
        return;
      }
      if (r.outcome === "up_to_date") {
        setUpdateDialog({ phase: "uptodate" });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setUpdateDialog({ phase: "error", message });
    }
  }, []);

  const closeUpdateDialog = useCallback(() => {
    setUpdateDialog((d) => {
      if (d?.phase === "installing") return d;
      return null;
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <Loader2 size={28} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="bg-bg flex flex-col min-h-0 animate-fade-in">
      <header className="sentinel-agent-topnav">
        <div className="sentinel-agent-topnav-identity">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span className="sentinel-agent-topnav-title">Sentinel</span>
          <div className="sentinel-agent-topnav-agent-row" title="Check for updates">
            <span className="sentinel-agent-topnav-agent-label">Agent</span>
            {appVersion ? (
              <>
                <span className="sentinel-agent-topnav-agent-sep" aria-hidden>
                  |
                </span>
                <button
                  type="button"
                  className="sentinel-agent-topnav-version-btn"
                  onClick={() => void openUpdateCheck()}
                  disabled={
                    updateDialog?.phase === "checking" || updateDialog?.phase === "installing"
                  }
                >
                  v{appVersion}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <StatusBadge
          status={status.status}
          message={status.message}
          className="sentinel-agent-nav-status"
        />
      </header>

      {/* ── Body ── */}
      <main className="flex-1 p-5 min-h-0 overflow-auto">

        {/* ── Connection section ── */}
        <section className="mb-5">
          <h2 className="sentinel-agent-section-label">
            <Settings size={14} className="opacity-80" aria-hidden />
            Connection
          </h2>

          <div className="sentinel-agent-panel">
            <FormGroup>
              <Label htmlFor="server-url">Server URL</Label>
              <input
                id="server-url"
                type="text"
                value={config.server_url}
                onChange={(e) => setConfig((c) => ({ ...c, server_url: e.target.value }))}
                placeholder="wss://host:port/ws/agent"
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="agent-name">Agent Name</Label>
              <input
                id="agent-name"
                type="text"
                value={config.agent_name}
                onChange={(e) => setConfig((c) => ({ ...c, agent_name: e.target.value }))}
                placeholder="My-PC"
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="agent-password">Agent Password</Label>
              <PasswordInput
                id="agent-password"
                value={config.agent_password}
                onChange={(v) => setConfig((c) => ({ ...c, agent_password: v }))}
                placeholder="Server auth secret"
              />
            </FormGroup>

            <FormGroup>
              <label className="sentinel-agent-toggle">
                <input
                  id="auto-update-enabled"
                  type="checkbox"
                  checked={config.auto_update_enabled}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, auto_update_enabled: e.target.checked }))
                  }
                />
                <span>Auto updates</span>
              </label>
            </FormGroup>
            
            <p className="text-xs text-muted mt-4">
              TLS is enforced: the agent must connect using <code>wss://</code>.
            </p>
          </div>
        </section>

        {/* ── UI Password section (collapsible) ── */}
        <section className="mb-5">
          <button
            type="button"
            onClick={() => setPwOpen((o) => !o)}
            className="sentinel-agent-section-label mb-3 w-full text-left bg-transparent border-none p-0 cursor-pointer hover:opacity-90"
          >
            <Lock size={14} className="opacity-80" aria-hidden />
            <span className="flex-1 text-left">UI access password</span>
            {pwOpen ? (
              <ChevronUp size={14} className="opacity-70 shrink-0" aria-hidden />
            ) : (
              <ChevronDown size={14} className="opacity-70 shrink-0" aria-hidden />
            )}
          </button>

          {pwOpen && (
            <div className="sentinel-agent-panel animate-fade-in">
              <p className="text-xs text-muted mb-4">
                Leave blank to keep the current password. Set a password to require it when
                reopening the settings window via Ctrl+Shift+F12.
              </p>

              <FormGroup>
                <Label htmlFor="new-password">New Password</Label>
                <PasswordInput
                  id="new-password"
                  value={newPw}
                  onChange={setNewPw}
                  placeholder="New password"
                />
              </FormGroup>

              <FormGroup>
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <PasswordInput
                  id="confirm-password"
                  value={confirmPw}
                  onChange={setConfirmPw}
                  placeholder="Confirm password"
                />
              </FormGroup>
            </div>
          )}
        </section>

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleSave} disabled={saving} className="sentinel-btn-primary">
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </button>

          <button type="button" onClick={handleClose} className="sentinel-btn-secondary">
            <X size={14} />
            Close
          </button>

          <div className="flex-1 min-w-[8px]" />

          <button type="button" onClick={handleExit} className="sentinel-btn-danger">
            <Power size={14} />
            Exit agent
          </button>
        </div>

        {/* ── Save message ── */}
        {saveMsg && (
          <p
            className={`mt-3 text-sm flex items-center gap-1.5 animate-fade-in
                        ${saveMsg.ok ? "text-ok" : "text-danger"}`}
          >
            {!saveMsg.ok && <AlertTriangle size={13} />}
            {saveMsg.text}
          </p>
        )}

        {/* ── Hotkey hint ── */}
        <p className="mt-4 text-[11px] text-muted">
          Reopen anytime: <kbd className="sentinel-kbd">Ctrl+Shift+F12</kbd>
        </p>
      </main>

      {updateDialog !== null && (
        <div
          className="sentinel-agent-modal-backdrop"
          onClick={closeUpdateDialog}
          role="presentation"
        >
          <div
            className="sentinel-agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {updateDialog.phase === "checking" && (
              <>
                <h2 id="update-dialog-title" className="text-base font-semibold mb-3">
                  Checking for updates
                </h2>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={18} className="animate-spin shrink-0" />
                  Contacting update server…
                </div>
              </>
            )}

            {updateDialog.phase === "uptodate" && (
              <>
                <h2 id="update-dialog-title" className="text-base font-semibold mb-2">
                  You&apos;re up to date
                </h2>
                <p className="text-sm text-muted mb-4">
                  This build matches the latest published Sentinel agent version.
                </p>
                <button type="button" className="sentinel-btn-primary" onClick={closeUpdateDialog}>
                  OK
                </button>
              </>
            )}

            {updateDialog.phase === "available" && (
              <>
                <h2 id="update-dialog-title" className="text-base font-semibold mb-2">
                  Update available
                </h2>
                <p className="text-sm mb-4">
                  Version <strong>{updateDialog.publishedVersion}</strong> is available. The agent
                  will download the installer and restart. When the update finishes, this settings
                  window opens again automatically.
                </p>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button type="button" className="sentinel-btn-secondary" onClick={closeUpdateDialog}>
                    Not now
                  </button>
                  <button type="button" className="sentinel-btn-primary" onClick={() => void applyManualUpdate()}>
                    Download and install
                  </button>
                </div>
              </>
            )}

            {updateDialog.phase === "installing" && (
              <>
                <h2 id="update-dialog-title" className="text-base font-semibold mb-3">
                  Installing update
                </h2>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={18} className="animate-spin shrink-0" />
                  Downloading and starting the installer. This window will close briefly, then reopen
                  after the update completes.
                </div>
              </>
            )}

            {updateDialog.phase === "error" && (
              <>
                <h2 id="update-dialog-title" className="text-base font-semibold mb-2 text-danger">
                  Update check failed
                </h2>
                <p className="text-sm text-muted mb-4 break-words">{updateDialog.message}</p>
                <button type="button" className="sentinel-btn-primary" onClick={closeUpdateDialog}>
                  OK
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

type AppScreen = "loading" | "password" | "settings";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");

  const checkLock = useCallback(() => {
    invoke<boolean>("has_ui_password")
      .then((has) => setScreen(has ? "password" : "settings"))
      .catch(() => setScreen("settings"));
  }, []);

  const forceRelock = useCallback(() => {
    // Immediately hide the settings UI (no flash), then decide whether a password gate is needed.
    setScreen("password");
    checkLock();
  }, [checkLock]);

  useEffect(() => {
    // Dynamic native auto-resizing
    const ob = new ResizeObserver(() => {
      const height = document.documentElement.scrollHeight;
      const win = getCurrentWebviewWindow();
      win.setSize(new LogicalSize(520, height));
    });
    ob.observe(document.body);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    checkLock();

    const unlistenLock = listen("lock_ui", () => {
      forceRelock();
    });

    // Re-lock whenever the window gains focus (covers hotkey show and any other way
    // the window is brought back into view).
    const unlistenFocus = getCurrentWebviewWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) forceRelock();
    });

    // Fallbacks: some platforms / versions are more reliable with DOM events.
    const onFocus = () => forceRelock();
    window.addEventListener("focus", onFocus);

    const onVisibility = () => {
      if (!document.hidden) forceRelock();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unlistenLock.then((unlisten: () => void) => unlisten());
      unlistenFocus.then((unlisten: () => void) => unlisten());
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkLock, forceRelock]);

  if (screen === "loading") {
    return (
      <div className="flex h-[200px] items-center justify-center bg-bg">
        <Loader2 size={28} className="animate-spin text-accent" />
      </div>
    );
  }

  if (screen === "password") {
    return <PasswordGate onUnlock={() => setScreen("settings")} />;
  }

  return <SettingsPanel />;
}
