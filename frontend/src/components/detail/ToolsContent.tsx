import HelpPanel from "@cloudscape-design/components/help-panel";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

export function ToolsContent() {
  return (
    <HelpPanel
      header={<h2>Agent details help</h2>}
      footer={
        <Box fontSize="body-s" color="text-body-secondary">
          Use tabs to switch telemetry views and use the page header actions for agent operations.
        </Box>
      }
    >
      <SpaceBetween size="m">
        <div>
          <Box variant="h3">Activity</Box>
          <div>Timeline sessions aggregated from windows, URLs and keystrokes.</div>
        </div>
        <div>
          <Box variant="h3">Screen</Box>
          <div>Live stream with remote control commands (mouse and keyboard).</div>
        </div>
        <div>
          <Box variant="h3">History tabs</Box>
          <div>Keys, windows and URLs support filtering, sorting and pagination.</div>
        </div>
      </SpaceBetween>
    </HelpPanel>
  );
}
