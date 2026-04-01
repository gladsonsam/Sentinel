import type { CardsProps, CollectionPreferencesProps } from "@cloudscape-design/components";
import type { Agent, AgentInfo, AgentLiveStatus } from "./types";
import { ConnectionStatus, ActivityStatus } from "../components/common/StatusIndicator";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";

export interface AgentCardItem extends Agent {
  liveStatus?: AgentLiveStatus;
  agentInfo?: AgentInfo | null;
  agentInfoReceivedAtMs?: number;
  fallbackLastWindow?: string;
  fallbackUptimeSecs?: number;
  fallbackUptimeReceivedAtMs?: number;
}

const formatTimestamp = (timestamp: string | null | undefined) => {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
};

export function createCardDefinitions(
  onSelectAgent: (agentId: string) => void,
  onPowerAction: (agentId: string) => void,
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
    const base = item.agentInfo?.uptime_secs ?? item.fallbackUptimeSecs;
    if (base == null) return undefined;
    if (!item.online) return base;
    const receivedAt = item.agentInfoReceivedAtMs ?? item.fallbackUptimeReceivedAtMs ?? 0;
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
          {item.agentInfo?.hostname || item.name}
        </Link>
      </SpaceBetween>
    ),
    sections: [
    {
      id: "status",
      header: "Status",
      content: (item) => (
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Box variant="awsui-key-label">Connection status:</Box>
          <ConnectionStatus
            connected={item.online}
            lastSeen={item.last_seen ? new Date(item.last_seen) : null}
          />
          {item.online && item.liveStatus?.activity === "afk" && (
            <ActivityStatus isAfk idleSeconds={item.liveStatus?.idleSecs} />
          )}
        </SpaceBetween>
      ),
    },
    {
      id: "details",
      header: "Details",
      content: (item) => {
        const lastWindow = item.liveStatus?.window || item.fallbackLastWindow || "—";
        const uptime = formatUptime(liveUptimeSecs(item));
        const lastSeen = formatTimestamp(item.last_seen);
        return (
          <SpaceBetween size="xs">
            <Box>
              <Box variant="awsui-key-label">Uptime</Box>
              <Box>{uptime}</Box>
            </Box>
            <Box>
              <Box variant="awsui-key-label">Last window</Box>
              <Box>{lastWindow}</Box>
            </Box>
            {!item.online && (
              <Box>
                <Box variant="awsui-key-label">Last seen</Box>
                <Box>{lastSeen}</Box>
              </Box>
            )}
          </SpaceBetween>
        );
      },
    },
    {
      id: "quick-actions",
      header: "Quick actions",
      content: (item) => (
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Button
            iconName={item.online ? "status-negative" : "refresh"}
            ariaLabel={item.online ? "Shutdown" : "Wake"}
            variant="icon"
            onClick={() => onPowerAction(item.id)}
          />
        </SpaceBetween>
      ),
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
  { label: "Details", id: "details" },
  { label: "Quick actions", id: "quick-actions" },
  { label: "Agent ID", id: "agent-id" },
];

export const PAGE_SIZE_OPTIONS: CollectionPreferencesProps.PageSizeOption[] = [
  { value: 6, label: "6 cards" },
  { value: 12, label: "12 cards" },
  { value: 24, label: "24 cards" },
];

export const DEFAULT_PREFERENCES = {
  pageSize: 12,
  visibleContent: ["status", "details", "quick-actions"],
};
