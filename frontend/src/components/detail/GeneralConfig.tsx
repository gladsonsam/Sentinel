import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Box from "@cloudscape-design/components/box";
import type { Agent, AgentInfo } from "../../lib/types";
import { ConnectionStatus } from "../common/StatusIndicator";
import { InfoLink } from "../common/InfoLink";

interface GeneralConfigProps {
  agent: Agent;
  info: AgentInfo | null;
  onOpenHelp: () => void;
}

export function GeneralConfig({ agent, info, onOpenHelp }: GeneralConfigProps) {
  const agentVersion = info?.agent_version || "—";
  return (
    <Container
      header={
        <Header
          variant="h2"
          info={<InfoLink onFollow={onOpenHelp} />}
          description="General agent summary and system details."
        >
          General configuration
        </Header>
      }
    >
      <ColumnLayout columns={3} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">Agent</Box>
          <div>{agent.name}</div>
        </div>
        <div>
          <Box variant="awsui-key-label">Connection</Box>
          <ConnectionStatus
            connected={agent.online}
            lastSeen={agent.last_seen ? new Date(agent.last_seen) : null}
          />
        </div>
        <div>
          <Box variant="awsui-key-label">Agent version</Box>
          <div>{agentVersion}</div>
        </div>
      </ColumnLayout>
    </Container>
  );
}
