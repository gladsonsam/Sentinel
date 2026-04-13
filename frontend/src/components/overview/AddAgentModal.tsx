import { useEffect, useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Alert from "@cloudscape-design/components/alert";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import { api } from "../../lib/api";
import { formatEnrollmentOtp6 } from "../../lib/formatEnrollmentCode";

export type AgentSetupHints = {
  mdns: "advertising" | "disabled_by_env" | "unavailable_no_wss_url";
  agent_wss_url: string | null;
  mdns_port: number;
};

interface AddAgentModalProps {
  visible: boolean;
  onDismiss: () => void;
}

function hintsInstruction(h: AgentSetupHints): { type: "info" | "warning"; header: string; body: string } {
  if (h.mdns === "advertising") {
    return {
      type: "info",
      header: "LAN discovery is on",
      body: `This server advertises Sentinel on the LAN (mDNS service _sentinel._tcp, port ${h.mdns_port}). On the Windows PC, open agent settings (Ctrl+Shift+F12): use Discover server, or paste the WebSocket URL below, then Connect with code.`,
    };
  }
  if (h.mdns === "disabled_by_env") {
    return {
      type: "warning",
      header: "LAN discovery is off",
      body:
        "mDNS is disabled on this server (SENTINEL_MDNS=0 or SENTINEL_MDNS_DISABLE=1). Enter the WebSocket URL manually on the agent. If no URL appears below, set PUBLIC_BASE_URL or SENTINEL_MDNS_WSS_URL on the server.",
    };
  }
  return {
    type: "warning",
    header: "WebSocket URL not configured",
    body:
      "Set PUBLIC_BASE_URL=https://… or SENTINEL_MDNS_WSS_URL=wss://…/ws/agent on the server, then reopen this dialog. Until then, use the wss:// URL that matches how you reach this dashboard.",
  };
}

export function AddAgentModal({ visible, onDismiss }: AddAgentModalProps) {
  const [hints, setHints] = useState<AgentSetupHints | null>(null);
  const [hintsErr, setHintsErr] = useState<string | null>(null);
  const [hintsLoading, setHintsLoading] = useState(false);

  const [enrollUses, setEnrollUses] = useState(1);
  const [enrollExpireHours, setEnrollExpireHours] = useState("");
  const [enrollNote, setEnrollNote] = useState("");
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<{
    token: string;
    uses: number;
    expires_at: string | null;
  } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setEnrollResult(null);
    setEnrollError(null);
    setHintsLoading(true);
    setHintsErr(null);
    void api
      .getAgentSetupHints()
      .then((r) => {
        setHints(r);
      })
      .catch((e: unknown) => {
        setHints(null);
        setHintsErr(String((e as { message?: string })?.message ?? e));
      })
      .finally(() => setHintsLoading(false));
  }, [visible]);

  const generateEnrollmentToken = async () => {
    setEnrollLoading(true);
    setEnrollError(null);
    try {
      const uses = Math.max(1, Math.min(100_000, Number(enrollUses) || 1));
      const body: {
        uses: number;
        expires_in_hours?: number;
        note?: string;
      } = { uses };
      const rawH = enrollExpireHours.trim();
      if (rawH !== "") {
        const h = Math.max(1, Math.min(24 * 365, parseInt(rawH, 10) || 0));
        if (h > 0) body.expires_in_hours = h;
      }
      if (enrollNote.trim()) body.note = enrollNote.trim();
      const r = await api.createAgentEnrollmentToken(body);
      setEnrollResult({
        token: r.enrollment_token,
        uses: r.uses,
        expires_at: r.expires_at,
      });
    } catch (e: unknown) {
      setEnrollError(String((e as { message?: string })?.message ?? e));
      setEnrollResult(null);
    } finally {
      setEnrollLoading(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const instruct = hints ? hintsInstruction(hints) : null;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      size="large"
      header="Add agent"
      footer={
        <Box float="right">
          <Button variant="link" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {hintsLoading ? (
          <Box color="text-body-secondary" fontSize="body-s">
            Loading server hints…
          </Box>
        ) : null}
        {hintsErr ? (
          <Alert type="error" dismissible onDismiss={() => setHintsErr(null)}>
            {hintsErr}
          </Alert>
        ) : null}
        {instruct ? (
          <Alert type={instruct.type} header={instruct.header}>
            {instruct.body}
          </Alert>
        ) : null}
        {hints?.agent_wss_url ? (
          <SpaceBetween size="xs">
            <Box fontSize="body-s" color="text-body-secondary">
              Agent WebSocket URL
            </Box>
            <Box variant="code" fontSize="body-m">
              {hints.agent_wss_url}
            </Box>
            <Box>
              <Button onClick={() => void copyText(hints.agent_wss_url!)}>Copy WebSocket URL</Button>
            </Box>
          </SpaceBetween>
        ) : null}

        <Box fontSize="body-s" color="text-body-secondary">
          Generates a <Box variant="strong">6-digit</Box> code. On the PC use <Box variant="strong">Connect with code</Box>{" "}
          in the agent settings. Treat it like a password; short expiry is recommended.
        </Box>
        <ColumnLayout columns={3} variant="text-grid">
          <FormField label="Uses" description="Successful adoptions per code.">
            <Input
              type="number"
              inputMode="numeric"
              value={String(enrollUses)}
              onChange={({ detail }) =>
                setEnrollUses(Math.max(1, Math.min(100_000, Number(detail.value) || 1)))
              }
            />
          </FormField>
          <FormField label="Expires in (hours)" description="Leave empty for no expiry.">
            <Input
              value={enrollExpireHours}
              onChange={({ detail }) => setEnrollExpireHours(detail.value)}
              placeholder="e.g. 72"
            />
          </FormField>
          <FormField label="Note (optional)" description="Stored with the token record.">
            <Input value={enrollNote} onChange={({ detail }) => setEnrollNote(detail.value)} />
          </FormField>
        </ColumnLayout>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" onClick={() => void generateEnrollmentToken()} loading={enrollLoading}>
            Generate code
          </Button>
          {enrollResult ? (
            <Button onClick={() => void copyText(enrollResult.token)}>Copy code</Button>
          ) : null}
        </SpaceBetween>
        {enrollError ? (
          <Alert type="error" dismissible onDismiss={() => setEnrollError(null)}>
            {enrollError}
          </Alert>
        ) : null}
        {enrollResult ? (
          <Alert type="success" header="Enrollment code (6 digits)">
            <Box variant="code" fontSize="display-l" margin={{ top: "xs" }} fontWeight="bold">
              {formatEnrollmentOtp6(enrollResult.token)}
            </Box>
            <Box fontSize="body-s" margin={{ top: "s" }} color="text-body-secondary">
              Uses remaining: {enrollResult.uses}
              {enrollResult.expires_at
                ? ` · Expires: ${new Date(enrollResult.expires_at).toLocaleString()}`
                : ""}
            </Box>
          </Alert>
        ) : null}
      </SpaceBetween>
    </Modal>
  );
}
