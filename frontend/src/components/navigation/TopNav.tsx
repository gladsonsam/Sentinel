import TopNavigation from "@cloudscape-design/components/top-navigation";

interface TopNavProps {
  onLogout: () => void;
  onShowPreferences: () => void;
  onBackToOverview?: () => void;
}

export function TopNav({
  onLogout,
  onShowPreferences,
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
