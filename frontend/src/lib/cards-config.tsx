import type { CardsProps, CollectionPreferencesProps } from "@cloudscape-design/components";
import type { Agent, AgentInfo, AgentLiveStatus } from "./types";
import { ConnectionStatus, ActivityStatus } from "../components/common/StatusIndicator";
import { LiveBadge } from "../components/common/LiveBadge";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";

export interface AgentCardItem extends Agent {
  liveStatus?: AgentLiveStatus;
  agentInfo?: AgentInfo | null;
  agentInfoReceivedAtMs?: number;
}

const formatTimestamp = (timestamp: string | null | undefined) => {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
};

export function createCardDefinitions(
  onSelectAgent: (agentId: string) => void,
  nowMs: number
): CardsProps.CardDefinition<AgentCardItem> {
  const formatUptime = (secs?: number) => {
    if (secs == null || secs < 0) return "—";
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };
  const liveUptimeSecs = (item: AgentCardItem) => {
    const base = item.agentInfo?.uptime_secs;
    if (base == null) return undefined;
    if (!item.online) return base;
    const receivedAt = item.agentInfoReceivedAtMs ?? 0;
    if (!receivedAt) return base;
    const extra = Math.max(0, Math.floor((nowMs - receivedAt) / 1000));
    return base + extra;
  };
  return {
    header: (item) => (
      <SpaceBetween direction="horizontal" size="xs">
        <Link
          href="#"
          fontSize="heading-m"
          onFollow={(event) => {
            event.preventDefault();
            onSelectAgent(item.id);
          }}
        >
          {item.name}
        </Link>
        {item.online && <LiveBadge variant="online" />}
      </SpaceBetween>
    ),
    sections: [
    {
      id: "status",
      header: "Status",
      content: (item) => (
        <SpaceBetween size="xs">
          <Box>
            <Box variant="awsui-key-label">Connection</Box>
            <ConnectionStatus
              connected={item.online}
              lastSeen={item.last_seen ? new Date(item.last_seen) : null}
            />
          </Box>
          <Box>
            <Box variant="awsui-key-label">Activity</Box>
            <ActivityStatus
              isAfk={item.liveStatus?.activity === "afk"}
              idleSeconds={item.liveStatus?.idleSecs}
            />
          </Box>
        </SpaceBetween>
      ),
    },
    {
      id: "window",
      header: "Last window",
      content: (item) => (item.online ? item.liveStatus?.window || "—" : "—"),
    },
    {
      id: "uptime",
      header: "Uptime",
      content: (item) => (item.online ? formatUptime(liveUptimeSecs(item)) : "—"),
    },
    {
      id: "last-seen",
      header: "Last seen",
      content: (item) => (!item.online ? formatTimestamp(item.last_seen) : "—"),
    },
    {
      id: "agent-id",
      header: "Agent ID",
      content: (item) => item.id,
    },
    ],
  };
}

export const VISIBLE_CONTENT_OPTIONS: CollectionPreferencesProps.VisibleContentOption[] = [
  { label: "Status", id: "status" },
  { label: "Last window", id: "window" },
  { label: "Uptime", id: "uptime" },
  { label: "Last seen", id: "last-seen" },
  { label: "Agent ID", id: "agent-id" },
];

export const PAGE_SIZE_OPTIONS: CollectionPreferencesProps.PageSizeOption[] = [
  { value: 6, label: "6 cards" },
  { value: 12, label: "12 cards" },
  { value: 24, label: "24 cards" },
];

export const DEFAULT_PREFERENCES = {
  pageSize: 12,
  visibleContent: ["status", "window", "uptime", "last-seen"],
};
