import AppLayout from "@cloudscape-design/components/app-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import { TopNav } from "../components/navigation/TopNav";
import { useState } from "react";
import type { ReactNode } from "react";
import type { NotificationItem } from "../hooks/useNotifications";
import { ToolsContent } from "../components/detail/ToolsContent";
import type { DashboardNavUser } from "../lib/types";

interface DashboardLayoutProps {
  navigation?: ReactNode;
  content: ReactNode;
  onLogout: () => void;
  onShowPreferences: () => void;
  onOpenActivityLog?: () => void;
  onOpenUsers?: () => void;
  /** Admin: URL / keystroke alert rules UI. */
  onOpenNotifications?: () => void;
  /** Admin: agent groups & membership (same area as alert rules). */
  onOpenAgentGroups?: () => void;
  onBackToOverview?: () => void;
  onGoHome: () => void;
  currentUser?: DashboardNavUser | null;
  contentType?: "default" | "table" | "form" | "cards";
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  showTools?: boolean;
  toolsOpen?: boolean;
  onToolsChange?: (open: boolean) => void;
}

export function DashboardLayout({
  navigation,
  content,
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onOpenUsers,
  onOpenNotifications,
  onOpenAgentGroups,
  onBackToOverview,
  onGoHome,
  currentUser = null,
  contentType = "default",
  notifications,
  onDismissNotification,
  showTools = false,
  toolsOpen = false,
  onToolsChange,
}: DashboardLayoutProps) {
  const [navigationOpen, setNavigationOpen] = useState(true);

  return (
    <>
      <TopNav
        onLogout={onLogout}
        onShowPreferences={onShowPreferences}
        onOpenActivityLog={onOpenActivityLog}
        onOpenUsers={onOpenUsers}
        onOpenNotifications={onOpenNotifications}
        onOpenAgentGroups={onOpenAgentGroups}
        onBackToOverview={onBackToOverview}
        onGoHome={onGoHome}
        currentUser={currentUser}
      />
      <AppLayout
        navigation={navigation}
        navigationOpen={navigationOpen}
        navigationHide={!navigation}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        notifications={
          <Flashbar
            items={notifications.map((n) => ({
              ...n,
              onDismiss: () => onDismissNotification(n.id),
            }))}
          />
        }
        content={<div className="sentinel-dashboard-main">{content}</div>}
        navigationWidth={280}
        toolsHide={!showTools}
        tools={showTools ? <ToolsContent /> : undefined}
        toolsOpen={toolsOpen}
        onToolsChange={({ detail }) => onToolsChange?.(detail.open)}
        contentType={contentType}
      />
    </>
  );
}
