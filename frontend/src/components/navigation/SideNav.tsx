import SideNavigation, { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

export type TabKey =
  | "activity"
  | "specs"
  | "screen"
  | "keys"
  | "windows"
  | "urls"
  | "files"
  | "settings";

interface SideNavProps {
  activeTab: TabKey;
  onTabChange: (tabKey: TabKey) => void;
}

const NAV_ITEMS: SideNavigationProps.Item[] = [
  {
    type: "section",
    text: "Monitoring",
    items: [
      {
        type: "link",
        text: "Activity Timeline",
        href: "#activity",
      },
      {
        type: "link",
        text: "System Specs",
        href: "#specs",
      },
      {
        type: "link",
        text: "Screen Viewer",
        href: "#screen",
      },
    ],
  },
  {
    type: "section",
    text: "History",
    items: [
      {
        type: "link",
        text: "Keystrokes",
        href: "#keys",
      },
      {
        type: "link",
        text: "Windows",
        href: "#windows",
      },
      {
        type: "link",
        text: "URLs",
        href: "#urls",
      },
      {
        type: "link",
        text: "Files",
        href: "#files",
      },
    ],
  },
  {
    type: "divider",
  },
  {
    type: "link",
    text: "Agent Settings",
    href: "#settings",
  },
];

export function SideNav({ activeTab, onTabChange }: SideNavProps) {
  const activeHref = `#${activeTab}`;

  const handleFollow: SideNavigationProps["onFollow"] = (event) => {
    event.preventDefault();
    const href = event.detail.href;
    if (href.startsWith("#")) {
      const tabKey = href.substring(1) as TabKey;
      onTabChange(tabKey);
    }
  };

  return (
    <SideNavigation
      header={{ text: "Navigation", href: "#" }}
      activeHref={activeHref}
      items={NAV_ITEMS}
      onFollow={handleFollow}
    />
  );
}
