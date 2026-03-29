import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";

interface FullPageHeaderProps {
  totalAgents: number;
  selectedCount: number;
  onRefresh: () => void;
  onWakeSelected: () => void;
  onRestartSelected: () => void;
  onShutdownSelected: () => void;
}

export function FullPageHeader({
  totalAgents,
  selectedCount,
  onRefresh,
  onWakeSelected,
  onRestartSelected,
  onShutdownSelected,
}: FullPageHeaderProps) {
  return (
    <Header
      variant="h1"
      counter={`(${totalAgents})`}
      description="Monitor connected agents and open a detail view for telemetry, controls, and history."
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={onRefresh} iconName="refresh">
            Refresh
          </Button>
          <Button disabled={selectedCount === 0} onClick={onWakeSelected}>
            Wake selected
          </Button>
          <Button disabled={selectedCount === 0} onClick={onRestartSelected}>
            Restart selected
          </Button>
          <Button disabled={selectedCount === 0} onClick={onShutdownSelected}>
            Shutdown selected
          </Button>
        </SpaceBetween>
      }
    >
      Agents
    </Header>
  );
}
