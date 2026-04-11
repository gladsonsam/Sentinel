import { useEffect, useState } from "react";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { api, SETTINGS_VERSION_POLL_INTERVAL_MS } from "../../lib/api";
import { dashboardRoleLabel, type DashboardNavUser } from "../../lib/types";

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
  const [versionLine, setVersionLine] = useState<{
    label: string;
    updateAvailable: boolean;
    releasesUrl: string;
    remoteVersion?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      void api
        .settingsVersionGet()
        .then((v) => {
          if (cancelled) return;
          setVersionLine({
            label: v.server_version,
            updateAvailable: v.server_update_available,
            releasesUrl: v.releases_url,
            remoteVersion: v.latest_server_release ?? undefined,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setVersionLine(null);
        });
    };

    load();
    const id = window.setInterval(load, SETTINGS_VERSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const versionTitle =
    versionLine == null
      ? "Server version (unavailable)"
      : versionLine.updateAvailable && versionLine.remoteVersion != null
        ? `This server is v${versionLine.label}. GitHub latest is v${versionLine.remoteVersion}. Open Settings for details.`
        : versionLine.updateAvailable
          ? `This server is v${versionLine.label}. A newer release may be available on GitHub.`
          : `This server is v${versionLine.label}. Matches or exceeds the latest GitHub release (last check).`;

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
          ...(versionLine != null
            ? [
                {
                  type: "button" as const,
                  variant: "link" as const,
                  text: versionLine.updateAvailable
                    ? `v${versionLine.label} · update available`
                    : `v${versionLine.label}`,
                  title: versionTitle,
                  ariaLabel: versionTitle,
                  onClick: () => onShowPreferences(),
                },
              ]
            : []),
          ...(versionLine?.updateAvailable
            ? [
                {
                  type: "button" as const,
                  variant: "link" as const,
                  text: "Update",
                  title:
                    versionLine.remoteVersion != null
                      ? `Version ${versionLine.remoteVersion} is available on GitHub`
                      : "A newer release may be available on GitHub",
                  href: versionLine.releasesUrl,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  external: true,
                  externalIconAriaLabel: "Opens in a new tab",
                },
              ]
            : []),
          {
            type: "menu-dropdown" as const,
            iconName: "user-profile" as const,
            text: currentUser
              ? `${currentUser.username}\n${dashboardRoleLabel(currentUser.role)}`
              : "Account",
            description: currentUser ? dashboardRoleLabel(currentUser.role) : undefined,
            title: "Account",
            ariaLabel: currentUser
              ? `${currentUser.username}, ${dashboardRoleLabel(currentUser.role)}`
              : "Account",
            items: [
              ...(onOpenUsers ? [{ id: "users", text: "Users" }] : []),
              ...(onOpenNotifications ? [{ id: "notifications", text: "Alerts" }] : []),
              ...(onOpenActivityLog
                ? [{ id: "activity_log", text: "Activity log" }]
                : []),
              { id: "settings", text: "Settings" },
              { id: "logout", text: "Logout" },
            ],
            onItemClick: ({ detail }) => {
              if (detail.id === "users") onOpenUsers?.();
              else if (detail.id === "notifications") onOpenNotifications?.();
              else if (detail.id === "activity_log") onOpenActivityLog?.();
              else if (detail.id === "settings") onShowPreferences();
              else if (detail.id === "logout") onLogout();
            },
          },
        ]}
      />
    </div>
  );
}
