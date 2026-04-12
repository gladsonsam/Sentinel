import TopNavigation from "@cloudscape-design/components/top-navigation";
import type { TopNavigationProps } from "@cloudscape-design/components/top-navigation";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import clsx from "clsx";
import { useMemo } from "react";
import { dashboardRoleLabel, type DashboardNavUser } from "../../lib/types";
import { usePollDashboardServerVersion } from "../../hooks/usePollDashboardServerVersion";
import { useServerVersionPayload } from "../../lib/serverVersionStore";
import { DashboardUserAvatar } from "../common/DashboardUserAvatar";

const MENU_SERVER_VERSION_ID = "sentinel_menu_server_version";

type AccountMenuUtility = Extract<TopNavigationProps.Utility, { type: "menu-dropdown" }> & {
  renderItem?: ButtonDropdownProps.ItemRenderer;
};

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onOpenUsers?: () => void;
  /** Admin: alerts (rules + history). */
  onOpenNotifications?: () => void;
  onBackToOverview?: () => void;
  /** Clicking the Sentinel logo/title returns here (usually agent overview). */
  onGoHome: () => void;
  currentUser?: DashboardNavUser | null;
}

export function TopNav({
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onOpenUsers,
  onOpenNotifications,
  onBackToOverview,
  onGoHome,
  currentUser = null,
}: TopNavProps) {
  usePollDashboardServerVersion();
  const versionPayload = useServerVersionPayload();

  const accountMenuUtility = useMemo((): AccountMenuUtility => {
    const updateAvailable = versionPayload?.server_update_available ?? false;
    const versionLabel = versionPayload?.server_version ?? null;
    const releasesUrlRaw = versionPayload?.releases_url?.trim() ?? "";
    const remoteVersion = versionPayload?.latest_server_release ?? null;
    const hasData = versionLabel != null;
    const canOpenReleases =
      hasData && (releasesUrlRaw.startsWith("https://") || releasesUrlRaw.startsWith("http://"));

    const serverMenuItem: ButtonDropdownProps.Item = canOpenReleases
      ? {
          id: MENU_SERVER_VERSION_ID,
          text: "Server version",
          ariaLabel:
            remoteVersion != null
              ? `Server v${versionLabel}. Latest GitHub release v${remoteVersion}. Opens GitHub releases in a new tab.`
              : `Server v${versionLabel}. Opens GitHub releases in a new tab.`,
          href: releasesUrlRaw,
          external: true,
          externalIconAriaLabel: "Opens in a new tab",
        }
      : {
          id: MENU_SERVER_VERSION_ID,
          text: "Server version",
          ariaLabel: hasData
            ? "Server version (GitHub releases link unavailable)."
            : "Loading server version.",
          disabled: true,
        };

    const renderItem: ButtonDropdownProps.ItemRenderer = ({ item }) => {
      if (item.type !== "action" || item.option.id !== MENU_SERVER_VERSION_ID) return null;
      const title = !hasData
        ? "Loading server version"
        : canOpenReleases
          ? "Open GitHub releases in a new tab"
          : `Server v${versionLabel}`;

      return (
        <div
          className={clsx(
            "sentinel-account-menu-version",
            updateAvailable && hasData && "sentinel-account-menu-version--update",
            !hasData && "sentinel-account-menu-version--loading",
          )}
          title={title}
        >
          <div className="sentinel-account-menu-version__eyebrow">Server</div>
          <div className="sentinel-account-menu-version__row">
            {hasData ? (
              <>
                <span className="sentinel-account-menu-version__ver">v{versionLabel}</span>
                {updateAvailable ? (
                  <span className="sentinel-account-menu-version__pill">Update available</span>
                ) : (
                  <span className="sentinel-account-menu-version__ok">Up to date</span>
                )}
              </>
            ) : (
              <span className="sentinel-account-menu-version__muted">Checking version…</span>
            )}
          </div>
          {hasData && remoteVersion != null ? (
            <div className="sentinel-account-menu-version__latest">Latest on GitHub: v{remoteVersion}</div>
          ) : hasData ? (
            <div className="sentinel-account-menu-version__latest sentinel-account-menu-version__latest--muted">
              Latest on GitHub: not reported
            </div>
          ) : null}
        </div>
      );
    };

    const items: ButtonDropdownProps.Items = [
      serverMenuItem,
      ...(onOpenUsers ? [{ id: "users", text: "Account" }] : []),
      ...(onOpenNotifications ? [{ id: "notifications", text: "Alerts" }] : []),
      ...(onOpenActivityLog ? [{ id: "activity_log", text: "Activity log" }] : []),
      { id: "settings", text: "Settings" },
      { id: "logout", text: "Logout" },
    ];

    const accountIcon = currentUser
      ? {
          iconSvg: (
            <DashboardUserAvatar
              username={currentUser.username}
              displayName={currentUser.display_name}
              displayIcon={currentUser.display_icon}
              size={22}
              className="sentinel-top-nav-account-avatar"
            />
          ),
        }
      : { iconName: "user-profile" as const };

    return {
      type: "menu-dropdown",
      ...accountIcon,
      text: currentUser ? (currentUser.display_name?.trim() || currentUser.username) : "Account",
      description: currentUser ? dashboardRoleLabel(currentUser.role) : undefined,
      title: "Account",
      ariaLabel: currentUser
        ? `${currentUser.display_name?.trim() || currentUser.username}, ${dashboardRoleLabel(currentUser.role)}`
        : "Account",
      badge: updateAvailable && versionLabel != null,
      items,
      renderItem,
      onItemClick: ({ detail }) => {
        if (detail.id === "users") onOpenUsers?.();
        else if (detail.id === "notifications") onOpenNotifications?.();
        else if (detail.id === "activity_log") onOpenActivityLog?.();
        else if (detail.id === "settings") onShowPreferences();
        else if (detail.id === "logout") onLogout();
      },
    };
  }, [
    currentUser,
    onLogout,
    onOpenActivityLog,
    onOpenNotifications,
    onOpenUsers,
    onShowPreferences,
    versionPayload,
  ]);

  return (
    <div id="sentinel-top-nav" className="sentinel-top-nav">
      <TopNavigation
        identity={{
          href: "#",
          title: "Sentinel",
          logo: {
            src: `${import.meta.env.BASE_URL}favicon.svg`,
            alt: "Sentinel",
          },
          onFollow: (event) => {
            event.preventDefault();
            onGoHome();
          },
        }}
        utilities={[
          ...(onBackToOverview
            ? [
                {
                  type: "button" as const,
                  text: "Back to overview",
                  iconName: "angle-left" as const,
                  onClick: onBackToOverview,
                },
              ]
            : []),
          accountMenuUtility as TopNavigationProps.Utility,
        ]}
      />
    </div>
  );
}
