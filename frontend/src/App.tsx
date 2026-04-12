import { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from "react";
import "@cloudscape-design/global-styles/index.css";
import "./styles/cloudscape-theme.css";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAgents } from "./hooks/useAgents";
import { useTheme } from "./hooks/useTheme";
import { useNotifications } from "./hooks/useNotifications";
import { api, apiUrl, setDashboardCsrfToken } from "./lib/api";
import type {
  Agent,
  AgentInfo,
  AgentLiveStatus,
  TabKey,
  DashboardSessionUser,
  DashboardNavUser,
  WsEvent,
} from "./lib/types";
import type { NotificationItem } from "./hooks/useNotifications";
import type { ThemeMode } from "./hooks/useTheme";
import { DashboardLayout } from "./layouts/DashboardLayout";

const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const AuthenticatedOverview = lazy(() =>
  import("./routes/AuthenticatedOverview").then((m) => ({ default: m.AuthenticatedOverview })),
);
const AuthenticatedAgentDetail = lazy(() =>
  import("./routes/AuthenticatedAgentDetail").then((m) => ({ default: m.AuthenticatedAgentDetail })),
);
const AuthenticatedSettings = lazy(() =>
  import("./routes/AuthenticatedSettings").then((m) => ({ default: m.AuthenticatedSettings })),
);
const AuthenticatedLogs = lazy(() =>
  import("./routes/AuthenticatedLogs").then((m) => ({ default: m.AuthenticatedLogs })),
);
const UsersPage = lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const AuthenticatedNotifications = lazy(() =>
  import("./routes/AuthenticatedNotifications").then((m) => ({ default: m.AuthenticatedNotifications })),
);
const AuthenticatedGroups = lazy(() =>
  import("./routes/AuthenticatedGroups").then((m) => ({ default: m.AuthenticatedGroups })),
);

function sessionToNavUser(u: DashboardSessionUser | null): DashboardNavUser | null {
  if (!u) return null;
  return {
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    display_icon: u.display_icon,
  };
}

/** Minimal first paint (no Cloudscape) while auth or route chunks load. */
function LoadShell({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        minHeight: "45vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: 15,
        color: "var(--awsui-color-text-body-secondary)",
      }}
    >
      {label}
    </div>
  );
}

type NavState = { from?: string } | null;

function isTabKey(v: string | null): v is TabKey {
  return (
    v === "live" ||
    v === "activity" ||
    v === "specs" ||
    v === "software" ||
    v === "scripts" ||
    v === "keys" ||
    v === "windows" ||
    v === "urls" ||
    v === "alerts" ||
    v === "files" ||
    v === "audit" ||
    v === "settings"
  );
}

function useReturnTo() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as NavState)?.from;
  return useCallback(() => {
    navigate(from ?? "/", { replace: true });
  }, [from, navigate]);
}

function OverviewRoute({
  agents,
  liveStatus,
  agentInfo,
  agentInfoReceivedAtMs,
  loadingAgents,
  onSelectAgent,
  onOpenScreen,
  onOpenUsers,
  onOpenNotifications,
  onOpenAgentGroups,
  currentUser,
  checkAuth,
  runBatchWake,
  runBatchAction,
  handleLogout,
  openSettings,
  openLogs,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
}: {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  agentInfo: Record<string, AgentInfo | null>;
  agentInfoReceivedAtMs: Record<string, number>;
  loadingAgents: boolean;
  onSelectAgent: (agentId: string) => void;
  onOpenScreen: (agentId: string) => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  onOpenAgentGroups?: () => void;
  currentUser: DashboardSessionUser | null;
  checkAuth: () => void;
  runBatchWake: (ids: string[]) => Promise<void>;
  runBatchAction: (agentIds: string[], cmdType: "RestartHost" | "ShutdownHost") => void;
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  openLogs: () => void;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
}) {
  return (
    <Suspense fallback={<LoadShell label="Loading dashboard…" />}>
      <AuthenticatedOverview
        agents={agents}
        liveStatus={liveStatus}
        agentInfo={agentInfo}
        agentInfoReceivedAtMs={agentInfoReceivedAtMs}
        loadingAgents={loadingAgents}
        onSelectAgent={onSelectAgent}
        onOpenScreen={onOpenScreen}
        onRefresh={checkAuth}
        onBatchWake={(ids) => void runBatchWake(ids)}
        onBatchRestart={(agentIds) => {
          runBatchAction(agentIds, "RestartHost");
        }}
        onBatchShutdown={(agentIds) => {
          runBatchAction(agentIds, "ShutdownHost");
        }}
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenActivityLog={openLogs}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onOpenAgentGroups={onOpenAgentGroups}
        onGoHome={() => {}}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
      />
    </Suspense>
  );
}

function AgentDetailRoute({
  agents,
  agentInfo,
  liveStatus,
  setSelectedAgentId,
  send,
  info,
  warning,
  error,
  handleLogout,
  openSettings,
  openLogs,
  onOpenUsers,
  onOpenNotifications,
  onOpenAgentGroups,
  currentUser,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
}: {
  agents: Record<string, Agent>;
  agentInfo: Record<string, AgentInfo | null>;
  liveStatus: Record<string, AgentLiveStatus>;
  setSelectedAgentId: (id: string | null) => void;
  send: (msg: unknown) => void;
  info: (header: string, content?: string) => void;
  warning: (header: string, content?: string) => void;
  error: (header: string, content?: string) => void;
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  openLogs: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  onOpenAgentGroups?: () => void;
  currentUser: DashboardSessionUser | null;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
}) {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo<TabKey>(() => {
    const tab = searchParams.get("tab");
    if (tab === "screen") return "live";
    return isTabKey(tab) ? tab : "live";
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("tab") !== "screen") return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "live");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // ISO timestamp for timeline highlight (from ?at=)
  const highlightTimestamp = searchParams.get("at") ?? null;

  useEffect(() => {
    setSelectedAgentId(agentId ?? null);
    return () => setSelectedAgentId(null);
  }, [agentId, setSelectedAgentId]);

  const agent = agentId ? agents[agentId] : null;
  if (!agentId) return <Navigate to="/" replace />;
  if (!agent) return <LoadShell label="Loading agent…" />;

  return (
    <Suspense fallback={<LoadShell label="Loading agent…" />}>
      <AuthenticatedAgentDetail
        agent={agent}
        agentInfo={agentInfo[agent.id] || null}
        liveStatus={liveStatus[agent.id]}
        sendWsMessage={send}
        onNotifyInfo={info}
        onNotifyWarning={warning}
        onNotifyError={error}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("tab", tab);
            return next;
          });
        }}
        onBackToOverview={() => navigate("/")}
        onOpenHelp={() => setToolsOpen(true)}
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenActivityLog={openLogs}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onOpenAgentGroups={onOpenAgentGroups}
        onGoHome={() => navigate("/")}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
        dashboardRole={currentUser?.role ?? null}
        highlightTimestamp={highlightTimestamp}
      />
    </Suspense>
  );
}

function SettingsRoute({
  themeMode,
  changeTheme,
  handleLogout,
  openSettings,
  openLogs,
  onOpenUsers,
  onOpenNotifications,
  currentUser,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
}: {
  themeMode: ThemeMode;
  changeTheme: (mode: ThemeMode) => void;
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  openLogs: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  currentUser: DashboardSessionUser | null;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
}) {
  const back = useReturnTo();
  const navigate = useNavigate();
  return (
    <Suspense fallback={<LoadShell label="Loading settings…" />}>
      <AuthenticatedSettings
        themeMode={themeMode}
        onThemeChange={changeTheme}
        onBack={back}
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenActivityLog={openLogs}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onGoHome={() => navigate("/")}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
      />
    </Suspense>
  );
}

function LogsRoute({
  handleLogout,
  openSettings,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
  onOpenUsers,
  onOpenNotifications,
  currentUser,
}: {
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  currentUser: DashboardSessionUser | null;
}) {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<LoadShell label="Loading activity log…" />}>
      <AuthenticatedLogs
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onGoHome={() => navigate("/")}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
      />
    </Suspense>
  );
}

function NotificationsRoute({
  handleLogout,
  openSettings,
  openLogs,
  onOpenUsers,
  onOpenNotifications,
  currentUser,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
}: {
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  openLogs: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  currentUser: DashboardSessionUser | null;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [notifySearch] = useSearchParams();
  if (currentUser?.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  if (notifySearch.get("tab") === "groups") {
    return <Navigate to="/groups" replace />;
  }
  return (
    <Suspense fallback={<LoadShell label="Loading notifications…" />}>
      <AuthenticatedNotifications
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenActivityLog={openLogs}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onGoHome={() => navigate("/")}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
      />
    </Suspense>
  );
}

function GroupsRoute({
  handleLogout,
  openSettings,
  openLogs,
  onOpenUsers,
  onOpenNotifications,
  currentUser,
  notifications,
  removeNotification,
  toolsOpen,
  setToolsOpen,
}: {
  handleLogout: () => Promise<void>;
  openSettings: () => void;
  openLogs: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  currentUser: DashboardSessionUser | null;
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  if (currentUser?.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return (
    <Suspense fallback={<LoadShell label="Loading groups…" />}>
      <AuthenticatedGroups
        onLogout={() => void handleLogout()}
        onShowPreferences={openSettings}
        onOpenActivityLog={openLogs}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onGoHome={() => navigate("/")}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
        currentUser={sessionToNavUser(currentUser)}
      />
    </Suspense>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [wsInitReceived, setWsInitReceived] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [me, setMe] = useState<DashboardSessionUser | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const openAgentGroupsAdmin = useCallback(() => navigate("/groups"), [navigate]);
  const openAlertRulesAdmin = useCallback(() => navigate("/notifications"), [navigate]);
  const adminAgentGroupsNav = me?.role === "admin" ? openAgentGroupsAdmin : undefined;
  const adminAlertRulesNav = me?.role === "admin" ? openAlertRulesAdmin : undefined;

  const {
    agents,
    liveStatus,
    agentInfo,
    agentInfoReceivedAtMs,
    updateAgent,
    updateAgentLiveStatus,
    updateAgentInfo,
    setAllAgents,
    setSelectedAgentId,
  } = useAgents();

  const { notifications, removeNotification, warning, info, error } = useNotifications();
  const { themeMode, changeTheme } = useTheme();
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectNotifiedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/auth/status"), {
        credentials: "include",
      });
      setAuthenticated(response.ok);
      if (response.ok) {
        fetch(apiUrl("/me"), { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            setMe(data);
            if (data && typeof data.csrf_token === "string" && data.csrf_token.length > 0) {
              setDashboardCsrfToken(data.csrf_token);
            } else {
              setDashboardCsrfToken(null);
            }
          })
          .catch(() => {
            setMe(null);
            setDashboardCsrfToken(null);
          });
      } else {
        setMe(null);
        setDashboardCsrfToken(null);
      }
    } catch {
      setAuthenticated(false);
      setMe(null);
      setDashboardCsrfToken(null);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const wsEnabled = authenticated === true;

  useEffect(() => {
    if (authenticated !== true) {
      setWsInitReceived(false);
    }
  }, [authenticated]);

  const { send } = useWebSocket({
    enabled: wsEnabled,
    onMessage: (event: WsEvent) => {
      switch (event.event) {
        case "init": {
          const agentMap: Record<string, Agent> = {};
          event.agents.forEach((agent) => {
            agentMap[agent.id] = agent;
          });
          setAllAgents(agentMap);
          setWsInitReceived(true);
          break;
        }

        case "agent_connected":
          if (event.agent_id && event.name) {
            const existing = agents[event.agent_id];
            updateAgent(event.agent_id, {
              id: event.agent_id,
              name: event.name,
              icon: existing?.icon ?? null,
              online: true,
              first_seen: event.connected_at || "",
              last_seen: event.connected_at || "",
              connected_at: event.connected_at,
              last_connected_at: event.connected_at,
              last_disconnected_at: null,
            });
          }
          break;

        case "agent_disconnected":
          if (event.agent_id) {
            const agent = agents[event.agent_id];
            if (agent) {
              updateAgent(event.agent_id, { ...agent, online: false });
            }
          }
          break;

        case "window_focus":
          if (event.agent_id) {
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              window: event.title,
              app: event.app,
            });
          }
          break;

        case "url":
          if (event.agent_id && event.url) {
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              url: event.url,
            });
          }
          break;

        case "afk":
          if (event.agent_id) {
            const idleSecs = typeof event.idle_secs === "number" && event.idle_secs >= 0 ? event.idle_secs : 0;
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              activity: "afk",
              idleSecs,
              idleSinceMs: Date.now() - idleSecs * 1000,
            });
          }
          break;

        case "active":
          if (event.agent_id) {
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              activity: "active",
              idleSecs: 0,
              idleSinceMs: undefined,
            });
          }
          break;

        case "agent_info":
          if (event.agent_id && event.data) {
            updateAgentInfo(event.agent_id, event.data);
          }
          break;

        case "alert_rule_match": {
          const aid = event.agent_id;
          const agentLabel =
            (aid && agents[aid]?.name) || event.agent_name || aid || "Agent";
          const ruleLabel = event.rule_name || `Rule #${event.rule_id ?? "?"}`;
          const snippet = event.snippet ? ` — ${event.snippet}` : "";
          warning("Alert rule matched", `${ruleLabel} · ${agentLabel}${snippet}`);
          break;
        }
      }
    },
    onStatusChange: (status) => {
      if (status === "connected") {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        disconnectNotifiedRef.current = false;
      } else if (status === "disconnected") {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
        }
        disconnectTimerRef.current = setTimeout(() => {
          disconnectNotifiedRef.current = true;
        }, 10000);
      }
    },
  });

  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(apiUrl("/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
    setDashboardCsrfToken(null);
    setAuthenticated(false);
  };

  const handleSelectAgent = (agentId: string) => {
    navigate(`/agents/${agentId}?tab=live`);
  };

  const handleOpenScreen = (agentId: string) => {
    navigate(`/agents/${agentId}?tab=live`);
  };

  const handleOpenSettings = () => {
    navigate("/settings", { state: { from: location.pathname + location.search } satisfies NavState });
  };

  const handleOpenLogs = () => {
    navigate("/logs", { state: { from: location.pathname + location.search } satisfies NavState });
  };

  const runBatchWake = useCallback(
    async (agentIds: string[]) => {
      if (agentIds.length === 0) return;
      const results = await Promise.allSettled(agentIds.map((id) => api.wakeAgent(id)));
      let ok = 0;
      const errors: string[] = [];
      results.forEach((r, i) => {
        const name = agents[agentIds[i]]?.name ?? agentIds[i];
        if (r.status === "fulfilled") ok += 1;
        else errors.push(`${name}: ${r.reason}`);
      });
      const fail = results.length - ok;
      if (fail === 0) {
        info(
          `Wake on LAN sent to ${ok} machine(s)`,
          "Magic packets use the MAC from each agent’s last stored system info.",
        );
      } else if (ok === 0) {
        error(
          "Wake on LAN failed",
          errors
            .slice(0, 3)
            .map((s) => String(s).replace(/^Error: /, ""))
            .join(" · ") + (errors.length > 3 ? " …" : ""),
        );
      } else {
        warning(
          `Wake sent to ${ok}; ${fail} failed`,
          errors
            .slice(0, 2)
            .map((s) => String(s).replace(/^Error: /, ""))
            .join(" · "),
        );
      }
    },
    [agents, error, info, warning],
  );

  const runBatchAction = useCallback(
    (agentIds: string[], cmdType: "RestartHost" | "ShutdownHost") => {
      const onlineIds = agentIds.filter((id) => agents[id]?.online);
      const offlineCount = agentIds.length - onlineIds.length;

      if (onlineIds.length === 0) {
        warning("No online agents selected", "Select at least one online agent to send this action.");
        return;
      }

      for (const id of onlineIds) {
        send({
          type: "control",
          agent_id: id,
          cmd: { type: cmdType },
        });
      }

      const actionLabel = cmdType === "RestartHost" ? "restart" : "shutdown";
      if (offlineCount > 0) {
        warning(
          `Sent ${actionLabel} to ${onlineIds.length} agent(s)`,
          `${offlineCount} offline agent(s) were skipped.`,
        );
      } else {
        info(`Sent ${actionLabel} to ${onlineIds.length} agent(s)`, "Commands queued over WebSocket.");
      }
    },
    [agents, info, warning, send],
  );

  if (authenticated === null) {
    return <LoadShell />;
  }

  if (!authenticated) {
    return (
      <Suspense fallback={<LoadShell label="Loading sign-in…" />}>
        <LoginPage onLoginSuccess={() => setAuthenticated(true)} />
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <OverviewRoute
            agents={agents}
            liveStatus={liveStatus}
            agentInfo={agentInfo}
            agentInfoReceivedAtMs={agentInfoReceivedAtMs}
            loadingAgents={!wsInitReceived}
            onSelectAgent={handleSelectAgent}
            onOpenScreen={handleOpenScreen}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            onOpenAgentGroups={adminAgentGroupsNav}
            currentUser={me}
            checkAuth={checkAuth}
            runBatchWake={runBatchWake}
            runBatchAction={runBatchAction}
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            openLogs={handleOpenLogs}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
          />
        }
      />
      <Route
        path="/agents/:agentId"
        element={
          <AgentDetailRoute
            agents={agents}
            agentInfo={agentInfo}
            liveStatus={liveStatus}
            setSelectedAgentId={setSelectedAgentId}
            send={send}
            info={info}
            warning={warning}
            error={error}
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            openLogs={handleOpenLogs}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            onOpenAgentGroups={adminAgentGroupsNav}
            currentUser={me}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
          />
        }
      />
      <Route
        path="/settings"
        element={
          <SettingsRoute
            themeMode={themeMode}
            changeTheme={changeTheme}
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            openLogs={handleOpenLogs}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            currentUser={me}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
          />
        }
      />
      <Route
        path="/logs"
        element={
          <LogsRoute
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            currentUser={me}
          />
        }
      />
      <Route
        path="/notifications"
        element={
          <NotificationsRoute
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            openLogs={handleOpenLogs}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            currentUser={me}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
          />
        }
      />
      <Route
        path="/groups"
        element={
          <GroupsRoute
            handleLogout={handleLogout}
            openSettings={handleOpenSettings}
            openLogs={handleOpenLogs}
            onOpenUsers={() => navigate("/users")}
            onOpenNotifications={adminAlertRulesNav}
            currentUser={me}
            notifications={notifications}
            removeNotification={removeNotification}
            toolsOpen={toolsOpen}
            setToolsOpen={setToolsOpen}
          />
        }
      />
      <Route
        path="/users"
        element={
          <Suspense fallback={<LoadShell label="Loading users…" />}>
            <DashboardLayout
              content={<UsersPage onAccountUpdated={checkAuth} />}
              onLogout={() => void handleLogout()}
              onShowPreferences={handleOpenSettings}
              onOpenActivityLog={handleOpenLogs}
              onOpenNotifications={adminAlertRulesNav}
              onGoHome={() => navigate("/")}
              contentType="default"
              notifications={notifications}
              onDismissNotification={removeNotification}
              showTools={false}
              toolsOpen={toolsOpen}
              onToolsChange={setToolsOpen}
              currentUser={sessionToNavUser(me)}
              onOpenUsers={() => navigate("/users")}
            />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
