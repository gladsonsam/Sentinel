import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import type { Agent } from "../../lib/types";
import { fmtDateTime } from "../../lib/utils";

export type AgentAction =
  | "restart-host"
  | "shutdown-host"
  | "request-info"
  | "wake-lan";

interface PageHeaderProps {
  agent: Agent;
  onBackToOverview?: () => void;
  onOpenHelp: () => void;
  onRunAction: (action: AgentAction) => void;
}

export function PageHeader({
  agent,
  onBackToOverview,
  onOpenHelp,
  onRunAction,
}: PageHeaderProps) {
  const handleItemClick: ButtonDropdownProps["onItemClick"] = ({ detail }) => {
    const id = detail.id as AgentAction;
    onRunAction(id);
  };

  return (
    <Header
      variant="h1"
      description={`Connected: ${agent.connected_at ? fmtDateTime(agent.connected_at) : "offline"}`}
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          {onBackToOverview && (
            <Button iconName="angle-left" onClick={onBackToOverview}>
              Back to overview
            </Button>
          )}
          <Button onClick={onOpenHelp}>Open help</Button>
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
      }
    >
      {agent.name}
    </Header>
  );
}
