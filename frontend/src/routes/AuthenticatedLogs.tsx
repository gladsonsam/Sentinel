import { DashboardLayout } from "../layouts/DashboardLayout";
import { LogsPage } from "../pages/LogsPage";
import type { NotificationItem } from "../hooks/useNotifications";

interface Props {
  onBack: () => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  onGoHome: () => void;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
}

export function AuthenticatedLogs({
  onBack,
  onLogout,
  onShowPreferences,
  onGoHome,
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
      onGoHome={onGoHome}
      onBackToOverview={onBack}
      contentType="default"
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={false}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
