import { DashboardLayout } from "../layouts/DashboardLayout";
import { SideNav } from "../components/navigation/SideNav";
import { AgentDetailPage } from "../pages/AgentDetailPage";
import type { Agent, AgentInfo, AgentLiveStatus, TabKey } from "../lib/types";
import type { NotificationItem } from "../hooks/useNotifications";

interface Props {
  agent: Agent;
  agentInfo: AgentInfo | null;
  liveStatus?: AgentLiveStatus;
  sendWsMessage: (msg: unknown) => void;
  onNotifyInfo: (header: string, content?: string) => void;
  onNotifyWarning: (header: string, content?: string) => void;
  onNotifyError: (header: string, content?: string) => void;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBackToOverview?: () => void;
  onOpenHelp: () => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  onOpenActivityLog: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  onGoHome: () => void;
  currentUser?: { username: string; role: "admin" | "operator" | "viewer" } | null;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
  /** ISO timestamp to scroll to and highlight in the activity timeline */
  highlightTimestamp?: string | null;
}

export function AuthenticatedAgentDetail({
  agent,
  agentInfo,
  liveStatus,
  sendWsMessage,
  onNotifyInfo,
  onNotifyWarning,
  onNotifyError,
  activeTab,
  onTabChange,
  onBackToOverview,
  onOpenHelp,
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onOpenUsers,
  onOpenNotifications,
  onGoHome,
  currentUser = null,
  notifications,
  onDismissNotification,
  toolsOpen,
  onToolsChange,
  highlightTimestamp,
}: Props) {
  return (
    <DashboardLayout
      navigation={
        <SideNav
          activeTab={activeTab}
          onTabChange={onTabChange}
          onGoOverview={onBackToOverview}
        />
      }
      content={
        <AgentDetailPage
          agent={agent}
          agentInfo={agentInfo}
          liveStatus={liveStatus}
          sendWsMessage={sendWsMessage}
          onNotifyInfo={onNotifyInfo}
          onNotifyWarning={onNotifyWarning}
          onNotifyError={onNotifyError}
          activeTab={activeTab}
          onTabChange={onTabChange}
          onBackToOverview={onBackToOverview}
          onOpenHelp={onOpenHelp}
          highlightTimestamp={highlightTimestamp}
        />
      }
      onLogout={onLogout}
      onShowPreferences={onShowPreferences}
      onOpenActivityLog={onOpenActivityLog}
      onOpenUsers={onOpenUsers}
      onOpenNotifications={onOpenNotifications}
      onGoHome={onGoHome}
      onBackToOverview={onBackToOverview}
      contentType="default"
      currentUser={currentUser}
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={true}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
