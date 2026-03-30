import { DashboardLayout } from "../layouts/DashboardLayout";
import { OverviewPage } from "../pages/OverviewPage";
import type { Agent, AgentLiveStatus } from "../lib/types";
import type { NotificationItem } from "../hooks/useNotifications";

interface Props {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
}

/** Single lazy chunk: layout + overview (avoids waterfall vs separate lazy imports). */
export function AuthenticatedOverview({
  agents,
  liveStatus,
  onSelectAgent,
  onRefresh,
  onBatchWake,
  onBatchRestart,
  onBatchShutdown,
  onLogout,
  onShowPreferences,
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
          onSelectAgent={onSelectAgent}
          onRefresh={onRefresh}
          onBatchWake={onBatchWake}
          onBatchRestart={onBatchRestart}
          onBatchShutdown={onBatchShutdown}
        />
      }
      onLogout={onLogout}
      onShowPreferences={onShowPreferences}
      contentType="cards"
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={false}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
