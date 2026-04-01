import type { CardsProps, CollectionPreferencesProps } from "@cloudscape-design/components";
import type { Agent, AgentInfo, AgentLiveStatus } from "./types";
import { ConnectionStatus, ActivityStatus } from "../components/common/StatusIndicator";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import { isAgentIconKey, AGENT_ICON_MAP } from "./agentIcons";
import { MonitorPlay } from "lucide-react";

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
  onOpenScreen: (agentId: string) => void,
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
      <div className="sentinel-agent-card-header">
        <div className="sentinel-agent-icon-lg" aria-hidden="true">
          {(() => {
            const key = isAgentIconKey(item.icon) ? item.icon : "monitor";
            const Icon = AGENT_ICON_MAP[key].Icon;
            return <Icon size={28} />;
          })()}
        </div>
        <div className="sentinel-agent-card-header-meta">
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
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            <ConnectionStatus
              connected={item.online}
              lastSeen={item.last_seen ? new Date(item.last_seen) : null}
            />
            {item.online && item.liveStatus?.activity === "afk" && (
              <ActivityStatus isAfk idleSeconds={item.liveStatus?.idleSecs} />
            )}
          </SpaceBetween>
        </div>
      </div>
    ),
    sections: [
      {
        id: "main",
        header: "",
        content: (item) => {
          const lastWindow = item.liveStatus?.window || item.fallbackLastWindow || "—";
          const lastSeen = formatTimestamp(item.last_seen);
          const uptime = formatUptime(liveUptimeSecs(item));

          const leftLabel = item.online ? "Uptime" : "Last seen";
          const leftValue = item.online ? uptime : lastSeen;

          return (
            <div className="sentinel-agent-card-main">
              <div className="sentinel-agent-card-main-top">
                <Box className="sentinel-agent-card-block sentinel-agent-card-block-details">
                  <Box variant="h3">Details</Box>
                  <SpaceBetween size="xs">
                    <Box>
                      <Box variant="awsui-key-label">{leftLabel}</Box>
                      <Box>{leftValue}</Box>
                    </Box>
                    <Box>
                      <Box variant="awsui-key-label">Last window</Box>
                      <Box className="sentinel-last-window">{lastWindow}</Box>
                    </Box>
                  </SpaceBetween>
                </Box>
              </div>

              <div className="sentinel-agent-card-actions-bottom">
                <div className="sentinel-agent-card-actions-bottom-row">
                  {item.online && (
                    <button
                      type="button"
                      className="sentinel-qa-icon"
                      aria-label="Open screen"
                      onClick={() => onOpenScreen(item.id)}
                    >
                      <MonitorPlay size={18} />
                    </button>
                  )}
                  <Button
                    iconName={item.online ? "status-negative" : "refresh"}
                    ariaLabel={item.online ? "Shutdown" : "Wake"}
                    variant="icon"
                    onClick={() => onPowerAction(item.id)}
                  />
                </div>
              </div>
            </div>
          );
        },
      },
    ],
  };
}

export const VISIBLE_CONTENT_OPTIONS: CollectionPreferencesProps.VisibleContentOption[] = [
  { label: "Main", id: "main" },
];

export const PAGE_SIZE_OPTIONS: CollectionPreferencesProps.PageSizeOption[] = [
  { value: 6, label: "6 cards" },
  { value: 12, label: "12 cards" },
  { value: 24, label: "24 cards" },
];

export const DEFAULT_PREFERENCES = {
  pageSize: 12,
  visibleContent: ["main"],
};
