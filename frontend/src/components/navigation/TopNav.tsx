import { useEffect, useState } from "react";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { api } from "../../lib/api";
import type { DashboardNavUser } from "../../lib/types";

const VERSION_POLL_MS = 30 * 60 * 1000;

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onOpenUsers?: () => void;
  /** Admin: alert rules / notification patterns. */
  onOpenNotifications?: () => void;
  /** Admin: agent groups (membership + rules scoped to groups). */
  onOpenAgentGroups?: () => void;
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
  onOpenAgentGroups,
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

  const identityTitle =
    versionLine != null ? `Sentinel | v${versionLine.label}` : "Sentinel";

  return (
    <div id="sentinel-top-nav" className="sentinel-top-nav">
      <TopNavigation
        identity={{
          href: "#",
          title: identityTitle,
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
              ? `${currentUser.display_icon?.trim() ? `${currentUser.display_icon.trim()} ` : ""}${currentUser.username} (${currentUser.role})`
              : "Account",
            title: "Account",
            ariaLabel: "Account",
            items: [
              ...(onOpenUsers
                ? [{ id: "users", text: "Team & profile" }]
                : []),
              ...(onOpenAgentGroups
                ? [{ id: "agent_groups", text: "Agent groups" }]
                : []),
              ...(onOpenNotifications
                ? [{ id: "notifications", text: "Alert rules" }]
                : []),
              ...(onOpenActivityLog
                ? [{ id: "activity_log", text: "Activity log" }]
                : []),
              { id: "settings", text: "Settings" },
              { id: "logout", text: "Logout" },
            ],
            onItemClick: ({ detail }) => {
              if (detail.id === "users") onOpenUsers?.();
              else if (detail.id === "agent_groups") onOpenAgentGroups?.();
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
