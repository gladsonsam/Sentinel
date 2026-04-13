import { useState, useEffect } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Toggle from "@cloudscape-design/components/toggle";
import { api } from "../../lib/api";

interface ControlTabProps {
  agentId: string;
  agentName: string;
  agentOnline: boolean;
  isAdmin: boolean;
}

export function ControlTab({ agentId, agentName, agentOnline, isAdmin }: ControlTabProps) {
  const [netBlocked, setNetBlocked] = useState(false);
  const [netLoad, setNetLoad] = useState(true);
  const [netSave, setNetSave] = useState(false);
  const [netErr, setNetErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNetLoad(true);
    api
      .agentInternetBlockedGet(agentId)
      .then((r) => { if (!cancelled) setNetBlocked(r.blocked); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNetLoad(false); });
    return () => { cancelled = true; };
  }, [agentId]);

  const applyNetworkPolicy = (blocked: boolean) => {
    setNetErr(null);
    setNetSave(true);
    api
      .agentInternetBlockedPut(agentId, { blocked })
      .then((r) => setNetBlocked(r.blocked))
      .catch((e) => setNetErr(String(e)))
      .finally(() => setNetSave(false));
  };

  if (!isAdmin) {
    return (
      <Alert type="info" header="Admin access required">
        Managing device controls requires administrator access.
      </Alert>
    );
  }

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            actions={
              !netLoad && (
                <StatusIndicator type={netBlocked ? "warning" : "success"}>
                  {netBlocked ? "Blocked" : "Allowed"}
                </StatusIndicator>
              )
            }
          >
            Internet access
          </Header>
        }
      >
        <SpaceBetween size="s">
          {!agentOnline && (
            <Alert type="warning" statusIconAriaLabel="Warning">
              {agentName} is offline — policy will apply on reconnect.
            </Alert>
          )}

          {netErr && (
            <Alert type="error" dismissible onDismiss={() => setNetErr(null)}>
              {netErr}
            </Alert>
          )}

          {netLoad ? (
            <Box color="text-status-inactive">Loading…</Box>
          ) : (
            <Toggle
              checked={netBlocked}
              disabled={netSave}
              onChange={({ detail }) => applyNetworkPolicy(detail.checked)}
            >
              Block internet
            </Toggle>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
