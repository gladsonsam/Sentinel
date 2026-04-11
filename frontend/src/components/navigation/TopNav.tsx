import { useEffect, useState } from "react";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import Badge from "@cloudscape-design/components/badge";
import { api } from "../../lib/api";

const VERSION_POLL_MS = 30 * 60 * 1000;

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onOpenUsers?: () => void;
  /** Admin: alert rules / notification patterns. */
  onOpenNotifications?: () => void;
  onBackToOverview?: () => void;
  /** Clicking the Sentinel logo/title returns here (usually agent overview). */
  onGoHome: () => void;
  currentUser?: { username: string; role: "admin" | "operator" | "viewer" } | null;
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
    const id = window.setInterval(load, VERSION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div id="sentinel-top-nav" className="sentinel-top-nav">
      {versionLine && (
        <div
          className="sentinel-top-nav__meta"
          aria-label={`Server version ${versionLine.label}`}
        >
          <span className="sentinel-top-nav__version">v{versionLine.label}</span>
          {versionLine.updateAvailable ? (
            <a
              className="sentinel-top-nav__update"
              href={versionLine.releasesUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={
                versionLine.remoteVersion
                  ? `Version ${versionLine.remoteVersion} is available on GitHub`
                  : "A newer release may be available on GitHub"
              }
            >
              <Badge color="blue">Update</Badge>
            </a>
          ) : null}
        </div>
      )}
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
          {
            type: "menu-dropdown" as const,
            iconName: "user-profile" as const,
            text: currentUser ? `${currentUser.username} (${currentUser.role})` : "Account",
            title: "Account",
            ariaLabel: "Account",
            items: [
              ...(onOpenUsers
                ? [{ id: "users", text: "Users" }]
                : []),
              ...(onOpenNotifications
                ? [{ id: "notifications", text: "Notifications" }]
                : []),
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
