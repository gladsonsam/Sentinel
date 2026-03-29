import type { CardsProps, CollectionPreferencesProps } from "@cloudscape-design/components";
import type { Agent, AgentLiveStatus } from "./types";
import { ConnectionStatus, ActivityStatus } from "../components/common/StatusIndicator";
import { LiveBadge } from "../components/common/LiveBadge";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";

export interface AgentCardItem extends Agent {
  liveStatus?: AgentLiveStatus;
}

const formatTimestamp = (timestamp: string | null | undefined) => {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
};

export function createCardDefinitions(
  onSelectAgent: (agentId: string) => void
): CardsProps.CardDefinition<AgentCardItem> {
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
      header: "Current window",
      content: (item) => item.liveStatus?.window || "—",
    },
    {
      id: "url",
      header: "Current URL",
      content: (item) => item.liveStatus?.url || "—",
    },
    {
      id: "last-seen",
      header: "Last seen",
      content: (item) => formatTimestamp(item.last_seen),
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
  { label: "Current window", id: "window" },
  { label: "Current URL", id: "url" },
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
  visibleContent: ["status", "window", "url", "last-seen"],
};
