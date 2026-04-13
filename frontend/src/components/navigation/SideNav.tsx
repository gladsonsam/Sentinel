import SideNavigation, { SideNavigationProps } from "@cloudscape-design/components/side-navigation";
import { AGENT_TAB_META, AGENT_TAB_ORDER } from "../../lib/agentTabNav";
import type { TabKey } from "../../lib/types";

export type { TabKey };

function navLink(id: TabKey): SideNavigationProps.Link {
  return {
    type: "link",
    text: AGENT_TAB_META[id].sideNavLabel,
    href: `#${id}`,
  };
}

/** Collapsible groups keep the sidebar scannable; tab row still lists every view. */
const NAV_ITEMS: SideNavigationProps.Item[] = [
  navLink("activity"),
  navLink("live"),
  navLink("control"),
  { type: "divider" },
  {
    type: "expandable-link-group",
    text: "System & tools",
    href: "#specs",
    defaultExpanded: false,
    items: [navLink("specs"), navLink("software"), navLink("scripts"), navLink("files")],
  },
  {
    type: "expandable-link-group",
    text: "Captured data",
    href: "#keys",
    defaultExpanded: false,
    items: [
      navLink("keys"),
      navLink("windows"),
      navLink("urls"),
      navLink("alerts"),
      navLink("logs"),
    ],
  },
  { type: "divider" },
  navLink("settings"),
];

interface SideNavProps {
  activeTab: TabKey;
  onTabChange: (tabKey: TabKey) => void;
  onGoOverview?: () => void;
}

export function SideNav({ activeTab, onTabChange, onGoOverview }: SideNavProps) {
  const activeHref = `#${activeTab}`;

  const handleFollow: SideNavigationProps["onFollow"] = (event) => {
    event.preventDefault();
    const href = event.detail.href;
    if (href === "#overview") {
      onGoOverview?.();
      return;
    }
    if (!href.startsWith("#")) return;
    const raw = href.slice(1);
    if (!raw || !(AGENT_TAB_ORDER as readonly string[]).includes(raw)) return;
    onTabChange(raw as TabKey);
  };

  return (
    <SideNavigation
      header={{ text: "Agent", href: "#overview" }}
      activeHref={activeHref}
      items={NAV_ITEMS}
      onFollow={handleFollow}
    />
  );
}
