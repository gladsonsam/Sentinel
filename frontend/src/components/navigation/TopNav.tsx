import TopNavigation from "@cloudscape-design/components/top-navigation";

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onBackToOverview?: () => void;
  /** Clicking the Sentinel logo/title returns here (usually agent overview). */
  onGoHome: () => void;
}

export function TopNav({
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onBackToOverview,
  onGoHome,
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
            type: "button" as const,
            iconName: "settings" as const,
            title: "Settings",
            ariaLabel: "Settings",
            onClick: onShowPreferences,
          },
          {
            type: "button" as const,
            iconName: "close" as const,
            title: "Logout",
            ariaLabel: "Logout",
            onClick: onLogout,
          },
        ]}
      />
    </div>
  );
}
