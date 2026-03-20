import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import {
  Monitor,
  Keyboard,
  Globe,
  Layout,
  Activity,
  Info,
  Loader2,
  Menu,
  ArrowLeft,
  LogOut,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { useWebSocket, type WsStatus } from "./hooks/useWebSocket";
import { Sidebar } from "./components/Sidebar";
import { OverviewGrid } from "./components/OverviewGrid";
import { ScreenTab } from "./components/ScreenTab";
import { KeysTab } from "./components/KeysTab";
import { WindowsTab } from "./components/WindowsTab";
import { UrlsTab } from "./components/UrlsTab";
import { ActivityTab } from "./components/ActivityTab";
import { PreferencesTab } from "./components/PreferencesTab";
import { AgentSettingsTab } from "./components/AgentSettingsTab";
import { LoginPage } from "./components/LoginPage";
import { Modal } from "./components/ui/Modal";
import { ToastProvider, useToast } from "./components/ui/ToastProvider";
import { cn } from "./lib/utils";
import { api } from "./lib/api";
import {
  loadThemePreference,
  loadNetworkIncludeIpv6,
  loadActivityCorrectedKeysDefault,
  type ThemePreference,
} from "./lib/preferences";
import type { Agent, AgentInfo, AgentLiveStatus, TabKey, WsEvent } from "./lib/types";

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; Icon: typeof Monitor }[] = [
  { key: "activity", label: "Activity", Icon: Activity },
  { key: "specs", label: "Specs", Icon: Info },
  { key: "screen", label: "Screen", Icon: Monitor },
  { key: "keys", label: "Keys", Icon: Keyboard },
  { key: "windows", label: "Windows", Icon: Layout },
  { key: "urls", label: "URLs", Icon: Globe },
  { key: "settings", label: "Overrides", Icon: SlidersHorizontal },
];

// ── Dashboard ─────────────────────────────────────────────────────────────────
// Rendered only when authenticated. Contains the WebSocket connection so it is
// never opened before the user has logged in.

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [liveStatus, setLiveStatus] = useState<Record<string, AgentLiveStatus>>(
    {},
  );
  const [agentInfo, setAgentInfo] = useState<Record<string, AgentInfo | null>>(
    {},
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"overview" | "detail" | "settings">(
    "overview",
  );
  const settingsReturnRef = useRef<"overview" | "detail">("overview");
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [themePref, setThemePref] = useState<ThemePreference>(() =>
    loadThemePreference(),
  );
  useEffect(() => {
    const root = window.document.documentElement;
    const apply = (dark: boolean) => {
      if (dark) root.classList.add("dark");
      else root.classList.remove("dark");
    };
    if (themePref === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const onChange = () => apply(mq.matches);
      mq.addEventListener("change", onChange);
      localStorage.setItem("theme", "system");
      return () => mq.removeEventListener("change", onChange);
    }
    apply(themePref === "dark");
    localStorage.setItem("theme", themePref);
  }, [themePref]);

  const [networkIncludeIpv6, setNetworkIncludeIpv6] = useState(
    () => loadNetworkIncludeIpv6(),
  );
  const [activityCorrectedKeysDefault, setActivityCorrectedKeysDefault] =
    useState(() => loadActivityCorrectedKeysDefault());

  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const { pushToast } = useToast();

  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendRef = useRef<((d: unknown) => void) | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // ── Live status helper ─────────────────────────────────────────────────────

  const updateLiveStatus = useCallback(
    (agentId: string, patch: Partial<AgentLiveStatus>) => {
      setLiveStatus((prev) => ({
        ...prev,
        [agentId]: { ...prev[agentId], ...patch },
      }));
    },
    [],
  );

  // ── Debounced data tab refresh ─────────────────────────────────────────────

  const scheduleRefresh = useCallback((agentId: string) => {
    if (agentId !== selectedRef.current) return;
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      setRefreshKey((k) => k + 1);
      refreshTimer.current = null;
    }, 3000);
  }, []);

  const forceRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    setRefreshKey((k) => k + 1);
  }, []);

  // ── WebSocket event handler ────────────────────────────────────────────────

  const handleMessage = useCallback(
    (ev: WsEvent) => {
      switch (ev.event) {
        case "init":
          setAgents(Object.fromEntries(ev.agents.map((a) => [a.id, a])));
          break;

        case "agent_connected": {
          const now = ev.connected_at ?? new Date().toISOString();
          setAgents((prev) => ({
            ...prev,
            [ev.agent_id]: {
              ...prev[ev.agent_id],
              id: ev.agent_id,
              name: ev.name,
              online: true,
              connected_at: now,
              last_connected_at: now,
              first_seen: prev[ev.agent_id]?.first_seen ?? now,
              last_seen: prev[ev.agent_id]?.last_seen ?? now,
              last_disconnected_at: prev[ev.agent_id]?.last_disconnected_at ?? null,
            },
          }));
          break;
        }

        case "agent_disconnected":
          setAgents((prev) => {
            const n = { ...prev };
            const existing = n[ev.agent_id];
            if (!existing) return n;
            const disconnectedAt = ev.disconnected_at ?? new Date().toISOString();
            n[ev.agent_id] = {
              ...existing,
              online: false,
              connected_at: null,
              last_seen: disconnectedAt,
              last_disconnected_at: disconnectedAt,
            };
            return n;
          });
          break;

        case "window_focus":
          updateLiveStatus(ev.agent_id, { window: ev.title, app: ev.app });
          scheduleRefresh(ev.agent_id);
          break;

        case "agent_info":
          if (ev.data) {
            setAgentInfo((prev) => ({ ...prev, [ev.agent_id]: ev.data ?? null }));
          }
          break;

        case "url":
          updateLiveStatus(ev.agent_id, { url: ev.url });
          scheduleRefresh(ev.agent_id);
          break;

        case "afk":
          updateLiveStatus(ev.agent_id, {
            activity: "afk",
            idleSecs: ev.idle_secs,
          });
          scheduleRefresh(ev.agent_id);
          break;

        case "active":
          updateLiveStatus(ev.agent_id, {
            activity: "active",
            idleSecs: undefined,
          });
          scheduleRefresh(ev.agent_id);
          break;

        case "keys":
          scheduleRefresh(ev.agent_id);
          break;
      }
    },
    [updateLiveStatus, scheduleRefresh],
  );

  const { send } = useWebSocket({
    onMessage: handleMessage,
    onStatusChange: setWsStatus,
  });
  sendRef.current = send;

  // ── Control command forwarder ──────────────────────────────────────────────

  const sendControl = useCallback((cmd: unknown) => {
    const id = selectedRef.current;
    if (id) sendRef.current?.({ type: "control", agent_id: id, cmd });
  }, []);

  // ── Navigation helpers ─────────────────────────────────────────────────────

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    setView("detail");
    // Activity is the primary telemetry highlight in the UX.
    setActiveTab("activity");
    setRefreshKey(0);
    setSidebarOpen(false);
  }, []);

  const goOverview = useCallback(() => {
    setView("overview");
    setSelectedId(null);
    setSidebarOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    if (view === "overview" || view === "detail") {
      settingsReturnRef.current = view;
    }
    setView("settings");
    setSidebarOpen(false);
  }, [view]);

  const closeSettings = useCallback(() => {
    setView(settingsReturnRef.current);
  }, []);

  // ── Logout ─────────────────────────────────────────────────────────────────

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => {});
    onLogout();
  }, [onLogout]);

  const openClearHistoryDialog = useCallback(() => {
    setClearHistoryOpen(true);
  }, []);

  const confirmClearHistory = useCallback(async () => {
    if (!selectedId || clearingHistory) return;
    setClearHistoryOpen(false);
    setClearingHistory(true);
    try {
      const res = await api.clearAgentHistory(selectedId);
      forceRefresh();
      pushToast({
        variant: "success",
        title: "History cleared",
        message: `Cleared ${res.cleared_rows} rows for this agent.`,
      });
    } catch (e) {
      pushToast({
        variant: "error",
        title: "Failed to clear history",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setClearingHistory(false);
    }
  }, [selectedId, clearingHistory, forceRefresh, pushToast]);

  const selectedAgent = selectedId ? agents[selectedId] : null;
  const selectedAgentInfo = selectedId ? agentInfo[selectedId] : null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    api
      .agentInfo(selectedId)
      .then((d) => {
        if (cancelled) return;
        setAgentInfo((prev) => ({ ...prev, [selectedId]: d.info ?? null }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-bg text-primary overflow-hidden">
      {/* ── Header ── */}
      <header
        className="flex items-center gap-2 px-3 md:px-4 h-12 bg-surface
                         border-b border-border flex-shrink-0 min-w-0"
      >
        {/* Hamburger (mobile only) */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="md:hidden p-1.5 -ml-1 text-muted hover:text-primary
                     transition-colors flex-shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>

        {/* Title / breadcrumb */}
        {view === "settings" ? (
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={closeSettings}
              className="flex items-center gap-1 text-muted hover:text-primary
                         text-sm transition-colors flex-shrink-0"
            >
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Back</span>
            </button>
            <span className="text-border hidden sm:inline">/</span>
            <span className="text-sm font-medium truncate">Preferences</span>
          </div>
        ) : view === "detail" ? (
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={goOverview}
              className="flex items-center gap-1 text-muted hover:text-primary
                         text-sm transition-colors flex-shrink-0"
            >
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Overview</span>
            </button>
            <span className="text-border hidden sm:inline">/</span>
            <span className="text-sm font-medium truncate">
              {selectedAgent?.name ?? "Agent"}
            </span>
          </div>
        ) : (
          <span className="text-[15px] font-semibold tracking-wide">
            🛡 Sentinel
          </span>
        )}

        {/* Right side: settings + sign out */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={openSettings}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs
                       text-muted hover:text-primary hover:bg-border/40
                       transition-colors outline-none focus-visible:ring-2
                       focus-visible:ring-accent/50 focus-visible:ring-offset-0"
          >
            <Settings size={14} className="flex-shrink-0" />
            <span>Settings</span>
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs
                       text-muted hover:text-primary hover:bg-border/40
                       transition-colors outline-none focus-visible:ring-2
                       focus-visible:ring-accent/50 focus-visible:ring-offset-0"
          >
            <LogOut size={14} className="flex-shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <Sidebar
          agents={agents}
          selectedId={selectedId}
          view={view === "settings" ? "overview" : view}
          wsStatus={wsStatus}
          onSelect={selectAgent}
          onOverview={goOverview}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main content */}
        <main className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* ── Overview ── */}
          {view === "overview" && (
            <div className="flex-1 overflow-auto p-3 md:p-4">
              <OverviewGrid
                agents={agents}
                liveStatus={liveStatus}
                onOpen={selectAgent}
              />
            </div>
          )}

          {view === "settings" && (
            <div className="flex-1 overflow-auto p-3 md:p-4">
              <h1 className="text-lg font-semibold text-primary mb-4">
                Preferences
              </h1>
              <PreferencesTab
                themePref={themePref}
                onThemePrefChange={setThemePref}
                networkIncludeIpv6={networkIncludeIpv6}
                onNetworkIncludeIpv6Change={setNetworkIncludeIpv6}
                activityCorrectedKeysDefault={activityCorrectedKeysDefault}
                onActivityCorrectedKeysDefaultChange={
                  setActivityCorrectedKeysDefault
                }
              />
            </div>
          )}

          {/* ── Detail ── */}
          {view === "detail" && (
            <>
              {/* Tab bar + per-agent actions */}
              <div
                className="flex items-stretch bg-surface border-b border-border
                              flex-shrink-0 min-w-0"
              >
                <div className="flex overflow-x-auto min-w-0 flex-1">
                  {TABS.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 md:px-4 py-2.5 text-sm",
                        "border-b-2 transition-colors whitespace-nowrap flex-shrink-0",
                        activeTab === key
                          ? "text-primary border-accent"
                          : "text-muted border-transparent hover:text-primary",
                      )}
                    >
                      <Icon size={13} />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
                {selectedId && (
                  <div
                    className="flex-shrink-0 flex items-center gap-1 px-2 sm:px-3
                                  border-l border-border bg-surface"
                  >
                    <button
                      type="button"
                      onClick={openClearHistoryDialog}
                      disabled={clearingHistory}
                      className={cn(
                        "flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded text-xs font-medium",
                        "text-danger bg-transparent hover:bg-danger/15",
                        "focus-visible:bg-danger/15",
                        "transition-colors whitespace-nowrap",
                        "outline-none focus:outline-none focus-visible:outline-none",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                      title="Clear this agent’s stored history (windows, keys, URLs, activity)"
                    >
                      {clearingHistory ? (
                        <Loader2 size={14} className="animate-spin flex-shrink-0" />
                      ) : (
                        <Trash2 size={14} className="flex-shrink-0" />
                      )}
                      <span className="hidden sm:inline">Clear history</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-auto p-3 md:p-4">
                {selectedId && (
                  <>
                    {activeTab === "specs" && (
                      <AgentInfoPanel
                        agent={selectedAgent}
                        info={selectedAgentInfo}
                        includeIpv6={networkIncludeIpv6}
                      />
                    )}
                    {activeTab === "screen" && (
                      <ScreenTab
                        key={selectedId}
                        agentId={selectedId}
                        online={selectedAgent?.online ?? false}
                        onControl={sendControl}
                      />
                    )}
                    {activeTab === "keys" && (
                      <KeysTab agentId={selectedId} refreshKey={refreshKey} />
                    )}
                    {activeTab === "windows" && (
                      <WindowsTab
                        agentId={selectedId}
                        refreshKey={refreshKey}
                      />
                    )}
                    {activeTab === "urls" && (
                      <UrlsTab agentId={selectedId} refreshKey={refreshKey} />
                    )}
                    {activeTab === "activity" && (
                      <ActivityTab
                        agentId={selectedId}
                        refreshKey={refreshKey}
                        defaultCorrectedKeys={activityCorrectedKeysDefault}
                      />
                    )}
                    {activeTab === "settings" && selectedId && (
                      <AgentSettingsTab
                        key={selectedId}
                        agentId={selectedId}
                        agentName={selectedAgent?.name ?? "This computer"}
                      />
                    )}
                    {/* Blocklists/WFP tab intentionally removed for now */}
                  </>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <Modal
        open={clearHistoryOpen}
        title="Clear stored history?"
        onClose={() => setClearHistoryOpen(false)}
        actions={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setClearHistoryOpen(false)}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted hover:text-primary hover:bg-border/30 transition-colors"
              disabled={clearingHistory}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmClearHistory}
              disabled={clearingHistory}
              className="px-4 py-2 rounded-md text-sm font-medium border border-accent bg-accent/10 text-primary hover:bg-accent/20 disabled:opacity-50 transition-colors"
            >
              {clearingHistory ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Clearing…
                </span>
              ) : (
                "Clear history"
              )}
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          This deletes stored windows, keystrokes, URLs, and AFK/active history for
          this client.
        </p>
      </Modal>
    </div>
  );
}

function fmtGb(mb?: number) {
  if (typeof mb !== "number" || !Number.isFinite(mb)) return "—";
  // Backward-compat: some agent builds send kB in *_mb fields.
  // If the value is implausibly large for MB, normalize kB -> MB.
  const normalizedMb = mb > 1_000_000 ? mb / 1000 : mb;
  // We receive memory in MB; display in decimal GB with 1 decimal place.
  // Use decimal GB (1 GB = 1000 MB) so the UI matches typical
  // "RAM in GB" marketing-style numbers.
  const gb = normalizedMb / 1000;
  return `${gb.toFixed(1)} GB`;
}

function isIPv4(ip: string): boolean {
  // Fast IPv4 check: four dot-separated numeric octets.
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return v === "::1" || v.startsWith("127.");
}

/** IPv4 you’d actually use to reach the machine (LAN, VPN, or public). */
function isUsefulIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  const parts = ip.trim().split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = parts;
  if (a === 0) return false;
  if (a === 127) return false;
  // APIPA / link-local IPv4
  if (a === 169 && b === 254) return false;
  // Multicast & reserved (not normal host unicast)
  if (a >= 224) return false;
  return true;
}

function ipv4SortPriority(ip: string): number {
  const parts = ip.trim().split(".").map((p) => Number(p));
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 3;
}

function AgentInfoPanel({
  agent,
  info,
  includeIpv6,
}: {
  agent: Agent | null;
  info: AgentInfo | null | undefined;
  includeIpv6: boolean;
}) {
  if (!agent) return null;

  const adapters = info?.adapters ?? [];
  const primaryIps = (() => {
    const ips = adapters
      .flatMap((a) => a.ips ?? [])
      .filter(Boolean)
      .filter((ip) => !isLoopbackIp(ip));
    const uniqueIps = Array.from(new Set(ips));
    const ipv4 = uniqueIps
      .filter((ip) => isUsefulIPv4(ip))
      .sort((a, b) => ipv4SortPriority(a) - ipv4SortPriority(b));
    if (!includeIpv6) return ipv4.slice(0, 6);
    const ipv6List = uniqueIps.filter(
      (ip) => !isIPv4(ip) && !isLoopbackIp(ip),
    );
    return [...ipv4, ...ipv6List].slice(0, 12);
  })();

  return (
    <div className="bg-surface border-b border-border px-3 md:px-4 py-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-bg/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">
            Computer
          </div>
          <div className="mt-1 text-sm font-medium">
            {info?.hostname ?? agent.name}
          </div>
          <div className="mt-0.5 text-xs text-muted truncate">
            {info?.os_long_version ?? info?.os_name ?? "—"}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">
            Specs
          </div>
          <div className="mt-1 text-xs text-muted">
            <div className="truncate">
              <span className="text-primary">CPU:</span>{" "}
              {info?.cpu_brand
                ? `${info.cpu_brand}${info.cpu_cores ? ` (${info.cpu_cores} cores)` : ""}`
                : "—"}
            </div>
            <div className="truncate">
              <span className="text-primary">RAM:</span>{" "}
              {fmtGb(info?.memory_used_mb)} / {fmtGb(info?.memory_total_mb)}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">
            {includeIpv6 ? "Network" : "Network (IPv4)"}
          </div>
          <div className="mt-1 text-xs text-muted">
            {primaryIps.length === 0 ? (
              <div>—</div>
            ) : (
              primaryIps.map((ip) => (
                <div key={ip} className="font-mono truncate">
                  {ip}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Auth wrapper ──────────────────────────────────────────────────────────────
// Checks /api/auth/status on mount, then renders either the login page or
// the dashboard.  The Dashboard component (and its WebSocket connection) are
// only instantiated after a confirmed valid session.

type AuthState = "loading" | "login" | "ok";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    api
      .authStatus()
      .then((d) => setAuthState(d.authenticated ? "ok" : "login"))
      .catch(() => setAuthState("login"));
  }, []);

  let content: ReactNode = null;
  if (authState === "loading") {
    content = (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-muted" />
      </div>
    );
  } else if (authState === "login") {
    content = <LoginPage onSuccess={() => setAuthState("ok")} />;
  } else {
    content = <Dashboard onLogout={() => setAuthState("login")} />;
  }

  return <ToastProvider>{content}</ToastProvider>;
}
