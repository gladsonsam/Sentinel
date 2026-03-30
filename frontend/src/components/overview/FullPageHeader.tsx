import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";

const BULK_ACTION_ITEMS: ButtonDropdownProps.ItemOrGroup[] = [
  { id: "wake", text: "Wake selected" },
  { id: "script", text: "Run script on selected" },
  { id: "restart", text: "Restart selected" },
  { id: "shutdown", text: "Shutdown selected" },
];

interface FullPageHeaderProps {
  totalAgents: number;
  selectedCount: number;
  onRefresh: () => void;
  onWakeSelected: () => void;
  onBulkScript: () => void;
  onRestartSelected: () => void;
  onShutdownSelected: () => void;
}

export function FullPageHeader({
  totalAgents,
  selectedCount,
  onRefresh,
  onWakeSelected,
  onBulkScript,
  onRestartSelected,
  onShutdownSelected,
}: FullPageHeaderProps) {
  const onBulkActionClick: ButtonDropdownProps["onItemClick"] = ({ detail }) => {
    switch (detail.id) {
      case "wake":
        onWakeSelected();
        break;
      case "script":
        onBulkScript();
        break;
      case "restart":
        onRestartSelected();
        break;
      case "shutdown":
        onShutdownSelected();
        break;
      default:
        break;
    }
  };

  return (
    <Header
      variant="h1"
      counter={`(${totalAgents})`}
      description="Monitor connected agents and open a detail view for telemetry, controls, and history."
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Button onClick={onRefresh} iconName="refresh">
            Refresh
          </Button>
          {selectedCount > 0 && (
            <ButtonDropdown
              items={BULK_ACTION_ITEMS}
              onItemClick={onBulkActionClick}
              variant="normal"
              ariaLabel={`Bulk actions for ${selectedCount} selected agent${selectedCount === 1 ? "" : "s"}`}
              nativeTriggerAttributes={{
                className: "sentinel-overview-actions-pill",
              }}
            >
              Actions ({selectedCount})
            </ButtonDropdown>
          )}
        </SpaceBetween>
      }
    >
      Agents
    </Header>
  );
}
