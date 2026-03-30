import { DashboardLayout } from "../layouts/DashboardLayout";
import { SettingsPage } from "../pages/SettingsPage";
import type { NotificationItem } from "../hooks/useNotifications";
import type { ThemeMode } from "../hooks/useTheme";

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onBack: () => void;
  onLogout: () => void;
  onShowPreferences: () => void;
  notifications: NotificationItem[];
  onDismissNotification: (id: string) => void;
  toolsOpen: boolean;
  onToolsChange: (open: boolean) => void;
}

export function AuthenticatedSettings({
  themeMode,
  onThemeChange,
  onBack,
  onLogout,
  onShowPreferences,
  notifications,
  onDismissNotification,
  toolsOpen,
  onToolsChange,
}: Props) {
  return (
    <DashboardLayout
      content={<SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} onBack={onBack} />}
      onLogout={onLogout}
      onShowPreferences={onShowPreferences}
      contentType="default"
      notifications={notifications}
      onDismissNotification={onDismissNotification}
      showTools={false}
      toolsOpen={toolsOpen}
      onToolsChange={onToolsChange}
    />
  );
}
