import { useEffect, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { Agent, AgentInfo } from "../../lib/types";
import { ConnectionStatus } from "../common/StatusIndicator";
import { api } from "../../lib/api";

interface GeneralConfigProps {
  agent: Agent;
  info: AgentInfo | null;
}

export function GeneralConfig({ agent, info }: GeneralConfigProps) {
  const agentVersion = info?.agent_version || "—";
  const [latestAgentVersion, setLatestAgentVersion] = useState<string | null>(null);
  const [versionsLoad, setVersionsLoad] = useState(true);
  const [updateNow, setUpdateNow] = useState(false);
  const [updateNowErr, setUpdateNowErr] = useState<string | null>(null);
  const [updateNowOk, setUpdateNowOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVersionsLoad(true);
    api
      .settingsVersionGet()
      .then((v) => {
        if (cancelled) return;
        setLatestAgentVersion(v.latest_agent_version);
      })
      .catch(() => {
        if (cancelled) return;
        setLatestAgentVersion(null);
      })
      .finally(() => {
        if (cancelled) return;
        setVersionsLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizeVersion = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (!s || s === "—") return null;
    return s.replace(/^v/i, "");
  };

  const installed = useMemo(() => normalizeVersion(agentVersion), [agentVersion]);
  const latest = useMemo(() => normalizeVersion(latestAgentVersion), [latestAgentVersion]);
  const isOutOfDate = useMemo(() => {
    if (!installed || !latest) return false;
    return installed !== latest;
  }, [installed, latest]);

  const triggerUpdateNow = () => {
    setUpdateNowErr(null);
    setUpdateNowOk(null);
    setUpdateNow(true);
    api
      .agentUpdateNow(agent.id)
      .then(() => {
        setUpdateNowOk(
          "Update triggered. If the agent is connected, it will download and install the latest release.",
        );
      })
      .catch((e) => setUpdateNowErr(String(e)))
      .finally(() => setUpdateNow(false));
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
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
          <SpaceBetween size="xs">
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <div>{agentVersion}</div>
              {versionsLoad ? (
                <Spinner size="small" />
              ) : isOutOfDate ? (
                <StatusIndicator type="warning">Update available</StatusIndicator>
              ) : latest ? (
                <StatusIndicator type="success">Up to date</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">Unknown</StatusIndicator>
              )}
            </SpaceBetween>

            {isOutOfDate && (
              <Alert type="warning">
                New agent version <b>{latest}</b> is available.
              </Alert>
            )}

            {updateNowErr && (
              <Alert type="error" dismissible onDismiss={() => setUpdateNowErr(null)}>
                {updateNowErr}
              </Alert>
            )}
            {updateNowOk && (
              <Alert type="success" dismissible onDismiss={() => setUpdateNowOk(null)}>
                {updateNowOk}
              </Alert>
            )}

            <Button
              variant={isOutOfDate ? "primary" : "normal"}
              disabled={!agent.online || updateNow || !isOutOfDate}
              loading={updateNow}
              onClick={triggerUpdateNow}
            >
              Update now
            </Button>
            {!agent.online && (
              <Box fontSize="body-s" color="text-body-secondary">
                Agent is offline.
              </Box>
            )}
          </SpaceBetween>
        </div>
      </ColumnLayout>
    </Container>
  );
}
