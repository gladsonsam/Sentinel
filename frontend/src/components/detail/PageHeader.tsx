import { useEffect, useState } from "react";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import type { Agent, AgentLiveStatus } from "../../lib/types";
import { fmtDateTime } from "../../lib/utils";
import { ActivityStatus } from "../common/StatusIndicator";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

export type AgentAction =
  | "restart-host"
  | "shutdown-host"
  | "request-info"
  | "wake-lan";

interface PageHeaderProps {
  agent: Agent;
  liveStatus?: AgentLiveStatus;
  /**
   * If provided, show an "Idle / Away" indicator even when we haven't seen a live AFK WS event.
   * This is derived from stored telemetry (e.g. last activity_log row).
   */
  inferredIdleSeconds?: number | null;
  onOpenHelp: () => void;
  onRunAction: (action: AgentAction) => void;
}

export function PageHeader({
  agent,
  liveStatus,
  inferredIdleSeconds,
  onOpenHelp,
  onRunAction,
}: PageHeaderProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Keep AFK/idle counters ticking on the agent detail page.
  useEffect(() => {
    const needsTick =
      (agent.online && liveStatus?.activity === "afk" && typeof liveStatus.idleSinceMs === "number") ||
      inferredIdleSeconds != null;
    if (!needsTick) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [agent.online, liveStatus?.activity, liveStatus?.idleSinceMs, inferredIdleSeconds]);

  const handleItemClick: ButtonDropdownProps["onItemClick"] = ({ detail }) => {
    const id = detail.id as AgentAction;
    onRunAction(id);
  };

  const isAfk = agent.online && liveStatus?.activity === "afk";
  const showInferredIdle = !isAfk && inferredIdleSeconds != null && inferredIdleSeconds >= 60;
  const effectiveAfkIdleSecs =
    isAfk && typeof liveStatus?.idleSinceMs === "number"
      ? Math.max(0, Math.floor((nowMs - liveStatus.idleSinceMs) / 1000))
      : liveStatus?.idleSecs;

  const idleLine = isAfk ? (
    <ActivityStatus isAfk idleSeconds={effectiveAfkIdleSecs} />
  ) : showInferredIdle ? (
    <StatusIndicator type="warning">
      Idle / Away ({Math.floor((inferredIdleSeconds as number) / 60)}m)
    </StatusIndicator>
  ) : null;

  const connectedText = `Connected: ${agent.connected_at ? fmtDateTime(agent.connected_at) : "offline"}`;

  return (
    <Header
      variant="h1"
      description={
        <SpaceBetween size="xs">
          {idleLine}
          <div>{connectedText}</div>
          <SpaceBetween direction="horizontal" size="xs">
            <ButtonDropdown
              items={[{ id: "help", text: "Open help" }]}
              onItemClick={() => onOpenHelp()}
            >
              Open help
            </ButtonDropdown>
            <ButtonDropdown
              items={[
                { id: "wake-lan", text: "Wake on LAN" },
                { id: "request-info", text: "Request fresh system info" },
                { id: "restart-host", text: "Restart computer" },
                { id: "shutdown-host", text: "Shutdown computer" },
              ]}
              onItemClick={handleItemClick}
            >
              Actions
            </ButtonDropdown>
          </SpaceBetween>
        </SpaceBetween>
      }
    >
      {agent.name}
    </Header>
  );
}
