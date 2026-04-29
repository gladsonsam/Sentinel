import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";

const BULK_ACTION_BASE: ButtonDropdownProps.ItemOrGroup[] = [
  { id: "wake", text: "Wake selected" },
  { id: "script", text: "Run script on selected" },
  { id: "lock", text: "Lock selected" },
  { id: "restart", text: "Restart selected" },
  { id: "shutdown", text: "Shutdown selected" },
];

interface FullPageHeaderProps {
  totalAgents: number;
  selectedCount: number;
  onRefresh: () => void;
  onWakeSelected: () => void;
  onBulkScript: () => void;
  onLockSelected: () => void;
  onRestartSelected: () => void;
  onShutdownSelected: () => void;
  /** Admin: permanently forget agents from the server. */
  onDeleteSelected?: () => void;
  /** Admin: add all selected agents to an agent group (opens group picker from overview). */
  onBulkAddToGroup?: () => void;
  /** Admin: open enrollment / connection hints. */
  onAddAgent?: () => void;
}

export function FullPageHeader({
  totalAgents,
  selectedCount,
  onRefresh,
  onWakeSelected,
  onBulkScript,
  onLockSelected,
  onRestartSelected,
  onShutdownSelected,
  onDeleteSelected,
  onBulkAddToGroup,
  onAddAgent,
}: FullPageHeaderProps) {
  const bulkItems: ButtonDropdownProps.ItemOrGroup[] =
    [
      ...BULK_ACTION_BASE,
      ...(onBulkAddToGroup != null ? [{ id: "add_group", text: "Add selected to group" }] : []),
      ...(onDeleteSelected != null
        ? [
            { id: "delete", text: "Delete selected (forget)" },
          ]
        : []),
    ];

  const onBulkActionClick: ButtonDropdownProps["onItemClick"] = ({ detail }) => {
    switch (detail.id) {
      case "wake":
        onWakeSelected();
        break;
      case "script":
        onBulkScript();
        break;
      case "lock":
        onLockSelected();
        break;
      case "restart":
        onRestartSelected();
        break;
      case "shutdown":
        onShutdownSelected();
        break;
      case "add_group":
        onBulkAddToGroup?.();
        break;
      case "delete":
        onDeleteSelected?.();
        break;
      default:
        break;
    }
  };

  return (
    <Header
      variant="h1"
      counter={`(${totalAgents})`}
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Button onClick={onRefresh} iconName="refresh">
            Refresh
          </Button>
          {onAddAgent != null ? (
            <Button variant="primary" onClick={onAddAgent} iconName="add-plus">
              Add agent
            </Button>
          ) : null}
          {selectedCount > 0 && (
            <ButtonDropdown
              items={bulkItems}
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
