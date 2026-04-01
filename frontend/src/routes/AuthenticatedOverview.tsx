import { DashboardLayout } from "../layouts/DashboardLayout";
import { OverviewPage } from "../pages/OverviewPage";
import type { Agent, AgentInfo, AgentLiveStatus } from "../lib/types";
import type { NotificationItem } from "../hooks/useNotifications";

interface Props {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  agentInfo: Record<string, AgentInfo | null>;
  agentInfoReceivedAtMs: Record<string, number>;
  loadingAgents: boolean;
  onSelectAgent: (agentId: string) => void;
  onOpenScreen: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  onOpenActivityLog: () => void;
  onOpenUsers: () => void;
  onGoHome: () => void;
  currentUser?: { username: string; role: "admin" | "operator" | "viewer" } | null;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
}

/** Single lazy chunk: layout + overview (avoids waterfall vs separate lazy imports). */
export function AuthenticatedOverview({
  agents,
  liveStatus,
  agentInfo,
  agentInfoReceivedAtMs,
  loadingAgents,
  onSelectAgent,
  onOpenScreen,
  onRefresh,
  onBatchWake,
  onBatchRestart,
  onBatchShutdown,
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onOpenUsers,
  onGoHome,
  currentUser = null,
  notifications,
  onDismissNotification,
  toolsOpen,
  onToolsChange,
}: Props) {
  return (
    <DashboardLayout
      content={
        <OverviewPage
          agents={agents}
          liveStatus={liveStatus}
          agentInfo={agentInfo}
          agentInfoReceivedAtMs={agentInfoReceivedAtMs}
          loadingAgents={loadingAgents}
          onSelectAgent={onSelectAgent}
          onOpenScreen={onOpenScreen}
          onRefresh={onRefresh}
          onBatchWake={onBatchWake}
          onBatchRestart={onBatchRestart}
          onBatchShutdown={onBatchShutdown}
        />
      }
      onLogout={onLogout}
      onShowPreferences={onShowPreferences}
      onOpenActivityLog={onOpenActivityLog}
      onOpenUsers={onOpenUsers}
      onGoHome={onGoHome}
      contentType="cards"
      currentUser={currentUser}
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={false}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
