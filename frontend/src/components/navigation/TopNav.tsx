import TopNavigation from "@cloudscape-design/components/top-navigation";

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  /** Opens the central activity / audit log page. */
  onOpenActivityLog?: () => void;
  onBackToOverview?: () => void;
}

export function TopNav({
  onLogout,
  onShowPreferences,
  onOpenActivityLog,
  onBackToOverview,
}: TopNavProps) {
  return (
    <TopNavigation
      identity={{
        href: "#",
        title: "Sentinel",
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
  );
}
