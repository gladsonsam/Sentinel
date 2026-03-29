import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { Agent } from "../../lib/types";
import { fmtDateTime } from "../../lib/utils";

interface PageHeaderProps {
  agent: Agent;
  onBackToOverview?: () => void;
  onOpenHelp: () => void;
}

export function PageHeader({
  agent,
  onBackToOverview,
  onOpenHelp,
}: PageHeaderProps) {
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
              { id: "restart", text: "Restart agent" },
              { id: "shutdown", text: "Shutdown agent" },
              { id: "request-info", text: "Request fresh system info" },
            ]}
            onItemClick={() => {}}
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
