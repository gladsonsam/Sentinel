import { useState, useEffect, useRef } from "react";
import "@cloudscape-design/global-styles/index.css";
import "./styles/cloudscape-theme.css";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { SideNav, type TabKey } from "./components/navigation/SideNav";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAgents } from "./hooks/useAgents";
import { useTheme } from "./hooks/useTheme";
import { useNotifications } from "./hooks/useNotifications";
import { apiUrl } from "./lib/api";
import { ServerSettingsModal } from "./components/settings/ServerSettingsModal";

type ViewMode = "overview" | "detail";

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  
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
  
  const { notifications, removeNotification, success, warning, info } = useNotifications();
  const { themeMode, changeTheme } = useTheme();
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectNotifiedRef = useRef(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch(apiUrl("/auth/status"), {
        credentials: "include",
      });
      setAuthenticated(response.ok);
    } catch {
      setAuthenticated(false);
    }
  };

  const { send } = useWebSocket({
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

  if (authenticated === null) {
    return <div>Loading...</div>;
  }

  if (!authenticated) {
    return <LoginPage onLoginSuccess={() => setAuthenticated(true)} />;
  }

  if (viewMode === "overview") {
    return (
      <>
        <DashboardLayout
          content={
            <OverviewPage
              agents={agents}
              liveStatus={liveStatus}
              onSelectAgent={handleSelectAgent}
              onRefresh={checkAuth}
              onBatchRestart={(agentIds) => {
                info("Batch action", `Restart requested for ${agentIds.length} agent(s)`);
              }}
              onBatchShutdown={(agentIds) => {
                warning("Batch action", `Shutdown requested for ${agentIds.length} agent(s)`);
              }}
            />
          }
        onLogout={handleLogout}
        onShowPreferences={() => setSettingsVisible(true)}
        contentType="cards"
        notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
        <ServerSettingsModal
          visible={settingsVisible}
          onDismiss={() => setSettingsVisible(false)}
          themeMode={themeMode}
          onThemeChange={changeTheme}
        />
      </>
      );
  }

  if (viewMode === "detail" && selectedAgent) {
    return (
      <>
      <DashboardLayout
        navigation={<SideNav activeTab={activeTab} onTabChange={setActiveTab} />}
        content={
            <AgentDetailPage
              agent={selectedAgent}
              agentInfo={agentInfo[selectedAgent.id] || null}
              sendWsMessage={send}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onBackToOverview={handleBackToOverview}
              onOpenHelp={() => setToolsOpen(true)}
            />
          }
        onLogout={handleLogout}
        onShowPreferences={() => setSettingsVisible(true)}
          onBackToOverview={handleBackToOverview}
          contentType="default"
          notifications={notifications}
          onDismissNotification={removeNotification}
          toolsOpen={toolsOpen}
          onToolsChange={setToolsOpen}
        />
        <ServerSettingsModal
          visible={settingsVisible}
          onDismiss={() => setSettingsVisible(false)}
          themeMode={themeMode}
          onThemeChange={changeTheme}
        />
      </>
      );
  }

  return null;
}
