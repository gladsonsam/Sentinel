import TopNavigation from "@cloudscape-design/components/top-navigation";

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onOpenUsers?: () => void;
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
  onBackToOverview,
  onGoHome,
  currentUser = null,
}: TopNavProps) {
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
          ...(onOpenActivityLog
            ? [
                {
                  type: "button" as const,
                  iconName: "file-open" as const,
                  title: "Activity log",
                  ariaLabel: "Activity log",
                  onClick: onOpenActivityLog,
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
              { id: "settings", text: "Settings" },
              { id: "logout", text: "Logout" },
            ],
            onItemClick: ({ detail }) => {
              if (detail.id === "users") onOpenUsers?.();
              else if (detail.id === "settings") onShowPreferences();
              else if (detail.id === "logout") onLogout();
            },
          },
        ]}
      />
    </div>
  );
}
