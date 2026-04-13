import SpaceBetween from "@cloudscape-design/components/space-between";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AppWindow,
  Cpu,
  FolderOpen,
  History,
  Keyboard,
  LayoutGrid,
  Link2,
  Package,
  ScrollText,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";
import type { TabKey } from "./types";

/** Top-level agent page sections (horizontal tab bar). */
export type AgentSectionId = "live" | "system" | "data" | "control" | "settings";

export const AGENT_SECTION_ORDER: AgentSectionId[] = ["live", "control", "system", "data", "settings"];

/** Sub-views under “Live” (activity timeline default, then screen). */
export const AGENT_LIVE_SUBTABS: TabKey[] = ["activity", "live"];

/** Sub-views under “System” (machine context, tools, files). Max 6 for SegmentedControl. */
export const AGENT_SYSTEM_SUBTABS: TabKey[] = ["specs", "software", "scripts", "files"];

/** Sub-views under “Data” (telemetry / history). */
export const AGENT_DATA_SUBTABS: TabKey[] = ["keys", "windows", "urls", "alerts", "logs"];

export function agentSectionFromTabKey(tab: TabKey): AgentSectionId {
  if (tab === "live" || tab === "activity") return "live";
  if (AGENT_SYSTEM_SUBTABS.includes(tab)) return "system";
  if (AGENT_DATA_SUBTABS.includes(tab)) return "data";
  if (tab === "control") return "control";
  return "settings";
}

export function defaultTabForAgentSection(section: AgentSectionId): TabKey {
  switch (section) {
    case "live":
      return "activity";
    case "system":
      return "specs";
    case "data":
      return "keys";
    case "control":
      return "control";
    case "settings":
      return "settings";
  }
}

const SECTION_META: Record<AgentSectionId, { tabLabel: string; icon: LucideIcon }> = {
  live: { tabLabel: "Live", icon: LayoutGrid },
  system: { tabLabel: "System", icon: Server },
  data: { tabLabel: "Data", icon: History },
  control: { tabLabel: "Control", icon: Shield },
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
  "live",
  "control",
  "specs",
  "software",
  "scripts",
  "files",
  "keys",
  "windows",
  "urls",
  "alerts",
  "logs",
  "settings",
];

export interface AgentTabDefinition {
  tabLabel: string;
  sideNavLabel: string;
  breadcrumbLabel: string;
  icon: LucideIcon;
}

export const AGENT_TAB_META: Record<TabKey, AgentTabDefinition> = {
  live: {
    tabLabel: "Screen + activity",
    sideNavLabel: "Live desk",
    breadcrumbLabel: "Live desk",
    icon: LayoutGrid,
  },
  activity: {
    tabLabel: "Timeline only",
    sideNavLabel: "Timeline",
    breadcrumbLabel: "Activity timeline",
    icon: Activity,
  },
  specs: {
    tabLabel: "Specs",
    sideNavLabel: "Specs",
    breadcrumbLabel: "Specs",
    icon: Cpu,
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
  logs: {
    tabLabel: "Logs",
    sideNavLabel: "Logs",
    breadcrumbLabel: "Logs",
    icon: ScrollText,
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
  alerts: {
    tabLabel: "Events",
    sideNavLabel: "Events",
    breadcrumbLabel: "Rule events",
    icon: Zap,
  },
  files: {
    tabLabel: "Files",
    sideNavLabel: "Files",
    breadcrumbLabel: "Files",
    icon: FolderOpen,
  },
  control: {
    tabLabel: "Control",
    sideNavLabel: "Control",
    breadcrumbLabel: "Control",
    icon: Shield,
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
