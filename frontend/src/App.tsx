import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import "@cloudscape-design/global-styles/index.css";
import "./styles/cloudscape-theme.css";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAgents } from "./hooks/useAgents";
import { useTheme } from "./hooks/useTheme";
import { useNotifications } from "./hooks/useNotifications";
import { api, apiUrl } from "./lib/api";
import type { TabKey } from "./lib/types";

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
        color: "#5f6b7a",
      }}
    >
      {label}
    </div>
  );
}

type ViewMode = "overview" | "detail" | "settings" | "logs";

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [toolsOpen, setToolsOpen] = useState(false);
  const adminReturnRef = useRef<ViewMode>("overview");

  const {
    agents,
    liveStatus,
    agentInfo,
    selectedAgent,
    updateAgent,
    updateAgentLiveStatus,
    updateAgentInfo,
    setAllAgents,
    setSelectedAgentId,
  } = useAgents();

  const { notifications, removeNotification, success, warning, info, error } = useNotifications();
  const { themeMode, changeTheme } = useTheme();
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectNotifiedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/auth/status"), {
        credentials: "include",
      });
      setAuthenticated(response.ok);
    } catch {
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const wsEnabled = authenticated === true;

  const { send } = useWebSocket({
    enabled: wsEnabled,
    onMessage: (event: any) => {
      switch (event.event) {
        case "init":
          if (event.agents) {
            const agentMap: Record<string, any> = {};
            event.agents.forEach((agent: any) => {
              agentMap[agent.id] = agent;
            });
            setAllAgents(agentMap);
          }
          break;

        case "agent_connected":
          if (event.agent_id && event.name) {
            updateAgent(event.agent_id, {
              id: event.agent_id,
              name: event.name,
              online: true,
              first_seen: event.connected_at || "",
              last_seen: event.connected_at || "",
              connected_at: event.connected_at,
              last_connected_at: event.connected_at,
              last_disconnected_at: null,
            });
            if (viewMode === "detail" && selectedAgent?.id === event.agent_id) {
              success("Agent Connected", `${event.name} is now online`);
            }
          }
          break;

        case "agent_disconnected":
          if (event.agent_id) {
            const agent = agents[event.agent_id];
            if (agent) {
              updateAgent(event.agent_id, { ...agent, online: false });
              warning("Agent Disconnected", `${agent.name} went offline`);
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
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              activity: "afk",
              idleSecs: 0,
            });
          }
          break;

        case "active":
          if (event.agent_id) {
            updateAgentLiveStatus(event.agent_id, {
              ...liveStatus[event.agent_id],
              activity: "active",
              idleSecs: 0,
            });
          }
          break;

        case "agent_info":
          if (event.agent_id && event.data) {
            updateAgentInfo(event.agent_id, event.data);
          }
          break;
      }
    },
    onStatusChange: (status) => {
      if (status === "connected") {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (disconnectNotifiedRef.current) {
          info("Connected", "WebSocket connection re-established");
          disconnectNotifiedRef.current = false;
        }
      } else if (status === "disconnected") {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
        }
        disconnectTimerRef.current = setTimeout(() => {
          disconnectNotifiedRef.current = true;
          warning("Disconnected", "WebSocket connection lost");
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
    setAuthenticated(false);
  };

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setViewMode("detail");
    setActiveTab("activity");
  };

  const handleBackToOverview = () => {
    setViewMode("overview");
    setSelectedAgentId(null);
  };

  const handleOpenSettings = () => {
    if (viewMode === "settings") return;
    adminReturnRef.current = viewMode;
    setViewMode("settings");
  };

  const handleOpenLogs = () => {
    if (viewMode === "logs") return;
    adminReturnRef.current = viewMode;
    setViewMode("logs");
  };

  const handleBackFromAdmin = () => {
    setViewMode(adminReturnRef.current);
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

  if (viewMode === "overview") {
    return (
      <Suspense fallback={<LoadShell label="Loading dashboard…" />}>
        <AuthenticatedOverview
          agents={agents}
          liveStatus={liveStatus}
          onSelectAgent={handleSelectAgent}
          onRefresh={checkAuth}
          onBatchWake={(ids) => void runBatchWake(ids)}
          onBatchRestart={(agentIds) => {
            runBatchAction(agentIds, "RestartHost");
          }}
          onBatchShutdown={(agentIds) => {
            runBatchAction(agentIds, "ShutdownHost");
          }}
          onLogout={handleLogout}
          onShowPreferences={handleOpenSettings}
          onOpenActivityLog={handleOpenLogs}
          onGoHome={handleBackToOverview}
          notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
      </Suspense>
    );
  }

  if (viewMode === "detail" && selectedAgent) {
    return (
      <Suspense fallback={<LoadShell label="Loading agent…" />}>
        <AuthenticatedAgentDetail
          agent={selectedAgent}
          agentInfo={agentInfo[selectedAgent.id] || null}
          sendWsMessage={send}
          onNotifyInfo={info}
          onNotifyWarning={warning}
          onNotifyError={error}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onBackToOverview={handleBackToOverview}
          onOpenHelp={() => setToolsOpen(true)}
          onLogout={handleLogout}
          onShowPreferences={handleOpenSettings}
          onOpenActivityLog={handleOpenLogs}
          onGoHome={handleBackToOverview}
          notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
      </Suspense>
    );
  }

  if (viewMode === "settings") {
    return (
      <Suspense fallback={<LoadShell label="Loading settings…" />}>
        <AuthenticatedSettings
          themeMode={themeMode}
          onThemeChange={changeTheme}
          onBack={handleBackFromAdmin}
          onLogout={handleLogout}
          onShowPreferences={handleOpenSettings}
          onOpenActivityLog={handleOpenLogs}
          onGoHome={handleBackToOverview}
          notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
      </Suspense>
    );
  }

  if (viewMode === "logs") {
    return (
      <Suspense fallback={<LoadShell label="Loading activity log…" />}>
        <AuthenticatedLogs
          onBack={handleBackFromAdmin}
          onLogout={handleLogout}
          onShowPreferences={handleOpenSettings}
          onGoHome={handleBackToOverview}
          notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadShell label="Loading dashboard…" />}>
      <AuthenticatedOverview
        agents={agents}
        liveStatus={liveStatus}
        onSelectAgent={handleSelectAgent}
        onRefresh={checkAuth}
        onBatchWake={(ids) => void runBatchWake(ids)}
        onBatchRestart={(agentIds) => {
          runBatchAction(agentIds, "RestartHost");
        }}
        onBatchShutdown={(agentIds) => {
          runBatchAction(agentIds, "ShutdownHost");
        }}
        onLogout={handleLogout}
        onShowPreferences={handleOpenSettings}
        onOpenActivityLog={handleOpenLogs}
        onGoHome={handleBackToOverview}
        notifications={notifications}
        onDismissNotification={removeNotification}
        toolsOpen={toolsOpen}
        onToolsChange={setToolsOpen}
      />
    </Suspense>
  );
}
