import { DashboardLayout } from "../layouts/DashboardLayout";
import { LogsPage } from "../pages/LogsPage";
import type { NotificationItem } from "../hooks/useNotifications";
import type { DashboardNavUser } from "../lib/types";

interface Props {
  onBack: () => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  onOpenUsers: () => void;
  onOpenNotifications?: () => void;
  onGoHome: () => void;
  currentUser?: DashboardNavUser | null;
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
  onOpenNotifications,
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
      onOpenNotifications={onOpenNotifications}
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
