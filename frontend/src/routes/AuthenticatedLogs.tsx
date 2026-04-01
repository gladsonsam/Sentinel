import { DashboardLayout } from "../layouts/DashboardLayout";
import { LogsPage } from "../pages/LogsPage";
import type { NotificationItem } from "../hooks/useNotifications";

interface Props {
  onBack: () => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  onOpenUsers: () => void;
  onGoHome: () => void;
  currentUser?: { username: string; role: "admin" | "operator" | "viewer" } | null;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
}

export function AuthenticatedLogs({
  onBack,
  onLogout,
  onShowPreferences,
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
      content={<LogsPage />}
      onLogout={onLogout}
      onShowPreferences={onShowPreferences}
      onOpenUsers={onOpenUsers}
      onGoHome={onGoHome}
      onBackToOverview={onBack}
      contentType="default"
      currentUser={currentUser}
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={false}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
