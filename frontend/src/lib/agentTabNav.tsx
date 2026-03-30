import SpaceBetween from "@cloudscape-design/components/space-between";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AppWindow,
  Cpu,
  FolderOpen,
  History,
  Keyboard,
  Link2,
  Monitor,
  Package,
  ScrollText,
  Server,
  Settings,
  Terminal,
} from "lucide-react";
import type { TabKey } from "./types";

/** Top-level agent page sections (horizontal tab bar). */
export type AgentSectionId = "activity" | "system" | "data" | "settings";

export const AGENT_SECTION_ORDER: AgentSectionId[] = ["activity", "system", "data", "settings"];

/** Sub-views under “System” (machine context, remote tools, files). Max 6 for SegmentedControl. */
export const AGENT_SYSTEM_SUBTABS: TabKey[] = ["specs", "screen", "software", "scripts", "files"];

/** Sub-views under “Data” (telemetry / history). */
export const AGENT_DATA_SUBTABS: TabKey[] = ["keys", "windows", "urls", "audit"];

export function agentSectionFromTabKey(tab: TabKey): AgentSectionId {
  if (tab === "activity") return "activity";
  if (AGENT_SYSTEM_SUBTABS.includes(tab)) return "system";
  if (AGENT_DATA_SUBTABS.includes(tab)) return "data";
  return "settings";
}

export function defaultTabForAgentSection(section: AgentSectionId): TabKey {
  switch (section) {
    case "activity":
      return "activity";
    case "system":
      return "specs";
    case "data":
      return "keys";
    case "settings":
      return "settings";
  }
}

const SECTION_META: Record<AgentSectionId, { tabLabel: string; icon: LucideIcon }> = {
  activity: { tabLabel: "Activity", icon: Activity },
  system: { tabLabel: "System", icon: Server },
  data: { tabLabel: "Data", icon: History },
  settings: { tabLabel: "Settings", icon: Settings },
};

export function AgentSectionTabLabel({ section }: { section: AgentSectionId }) {
  const m = SECTION_META[section];
  const Icon = m.icon;
  return (
    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      <span>{m.tabLabel}</span>
    </SpaceBetween>
  );
}

export const AGENT_TAB_ORDER: TabKey[] = [
  "activity",
  "specs",
  "screen",
  "software",
  "scripts",
  "files",
  "keys",
  "windows",
  "urls",
  "audit",
  "settings",
];

export interface AgentTabDefinition {
  tabLabel: string;
  sideNavLabel: string;
  breadcrumbLabel: string;
  icon: LucideIcon;
}

export const AGENT_TAB_META: Record<TabKey, AgentTabDefinition> = {
  activity: {
    tabLabel: "Activity",
    sideNavLabel: "Activity",
    breadcrumbLabel: "Activity",
    icon: Activity,
  },
  specs: {
    tabLabel: "Specs",
    sideNavLabel: "Specs",
    breadcrumbLabel: "Specs",
    icon: Cpu,
  },
  screen: {
    tabLabel: "Screen",
    sideNavLabel: "Screen",
    breadcrumbLabel: "Screen",
    icon: Monitor,
  },
  software: {
    tabLabel: "Software",
    sideNavLabel: "Software",
    breadcrumbLabel: "Software",
    icon: Package,
  },
  scripts: {
    tabLabel: "Scripts",
    sideNavLabel: "Scripts",
    breadcrumbLabel: "Scripts",
    icon: Terminal,
  },
  keys: {
    tabLabel: "Keys",
    sideNavLabel: "Keystrokes",
    breadcrumbLabel: "Keystrokes",
    icon: Keyboard,
  },
  windows: {
    tabLabel: "Windows",
    sideNavLabel: "Windows",
    breadcrumbLabel: "Windows",
    icon: AppWindow,
  },
  urls: {
    tabLabel: "URLs",
    sideNavLabel: "URLs",
    breadcrumbLabel: "URLs",
    icon: Link2,
  },
  files: {
    tabLabel: "Files",
    sideNavLabel: "Files",
    breadcrumbLabel: "Files",
    icon: FolderOpen,
  },
  audit: {
    tabLabel: "Audit",
    sideNavLabel: "Audit log",
    breadcrumbLabel: "Audit log",
    icon: ScrollText,
  },
  settings: {
    tabLabel: "Settings",
    sideNavLabel: "Settings",
    breadcrumbLabel: "Settings",
    icon: Settings,
  },
};

export function agentTabBreadcrumbLabel(tab: TabKey): string {
  return AGENT_TAB_META[tab].breadcrumbLabel;
}
