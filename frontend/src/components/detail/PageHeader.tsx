import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
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
  onOpenHelp: () => void;
  onRunAction: (action: AgentAction) => void;
}

export function PageHeader({
  agent,
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
      }
    >
      {agent.name}
    </Header>
  );
}
