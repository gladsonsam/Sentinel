import { useEffect, useState } from "react";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import type { Agent, AgentLiveStatus } from "../../lib/types";
import { fmtDateTime } from "../../lib/utils";
import { ActivityStatus } from "../common/StatusIndicator";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Button from "@cloudscape-design/components/button";

export type AgentAction =
  | "restart-host"
  | "shutdown-host"
  | "lock-host"
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
  pendingAction?: AgentAction | null;
}

export function PageHeader({
  agent,
  liveStatus,
  inferredIdleSeconds,
  onOpenHelp,
  onRunAction,
  pendingAction = null,
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
  /** Live "active" from WS must win over a stale activity_log–based inference. */
  const liveSaysActive = agent.online && liveStatus?.activity === "active";
  const showInferredIdle =
    !isAfk &&
    !liveSaysActive &&
    inferredIdleSeconds != null &&
    inferredIdleSeconds >= 60;
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

  const canLock = agent.online;
  const canRestart = agent.online;
  const canShutdown = agent.online;
  const canRequestInfo = agent.online;

  const actionItems: ButtonDropdownProps.Item[] = [
    // Only show Wake when it's actually useful (offline). Avoid a disabled/grey button.
    ...(!agent.online
      ? ([
          { id: "wake-lan", text: "Wake on LAN" } satisfies ButtonDropdownProps.Item,
        ] as ButtonDropdownProps.Item[])
      : []),
    ...(canLock
      ? ([
          { id: "lock-host", text: "Lock computer" } satisfies ButtonDropdownProps.Item,
        ] as ButtonDropdownProps.Item[])
      : []),
    ...(canRestart
      ? ([
          { id: "restart-host", text: "Restart computer" } satisfies ButtonDropdownProps.Item,
        ] as ButtonDropdownProps.Item[])
      : []),
    ...(canShutdown
      ? ([
          { id: "shutdown-host", text: "Shutdown computer" } satisfies ButtonDropdownProps.Item,
        ] as ButtonDropdownProps.Item[])
      : []),
    { id: "help", text: "Open help" },
  ];

  return (
    <Header
      variant="h1"
      description={
        <SpaceBetween size="xs">
          {idleLine}
          <div>{connectedText}</div>
        </SpaceBetween>
      }
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Button
            iconName="refresh"
            disabled={!canRequestInfo || pendingAction === "request-info"}
            loading={pendingAction === "request-info"}
            onClick={() => onRunAction("request-info")}
          >
            Refresh info
          </Button>

          <ButtonDropdown
            items={actionItems}
            onItemClick={(e) => {
              const id = String(e.detail.id);
              if (id === "help") {
                onOpenHelp();
                return;
              }
              handleItemClick(e);
            }}
            variant="normal"
          />
        </SpaceBetween>
      }
    >
      {agent.name}
    </Header>
  );
}
