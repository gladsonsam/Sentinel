import Container from "@cloudscape-design/components/container";
// import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <Container>
      <Box textAlign="center" padding={{ vertical: "xxxl" }}>
        {icon && <Box margin={{ bottom: "m" }}>{icon}</Box>}
        <Box variant="h2" margin={{ bottom: "xs" }}>
          {title}
        </Box>
        {description && (
          <Box variant="p" color="text-body-secondary" margin={{ bottom: "m" }}>
            {description}
          </Box>
        )}
        {action && <Box>{action}</Box>}
      </Box>
    </Container>
  );
}

export function NoAgentsState() {
  return (
    <EmptyState
      title="No agents connected"
      description="Connect an agent to start monitoring. Configure the agent with your server URL and credentials."
    />
  );
}

export function NoDataState({ message = "No data available" }: { message?: string }) {
  return (
    <EmptyState
      title={message}
      description="Data will appear here once the agent starts sending telemetry."
    />
  );
}
