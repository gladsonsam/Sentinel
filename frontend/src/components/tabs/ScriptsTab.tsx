import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { api } from "../../lib/api";
import type { DashboardRole } from "../../lib/types";

interface ScriptsTabProps {
  agentId: string;
  dashboardRole?: DashboardRole | null;
}

export function ScriptsTab({ agentId, dashboardRole = null }: ScriptsTabProps) {
  const [remoteOk, setRemoteOk] = useState<boolean | null>(null);
  const [shell, setShell] = useState<{ label: string; value: string }>({
    label: "PowerShell",
    value: "powershell",
  });
  const [script, setScript] = useState("Get-ComputerInfo | Select-Object WindowsProductName, OsVersion | Format-List");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .capabilities()
      .then((c) => setRemoteOk(c.remote_script))
      .catch(() => setRemoteOk(false));
  }, []);

  const run = async () => {
    setErr(null);
    setResult(null);
    setRunning(true);
    try {
      const out = await api.runAgentScript(agentId, {
        shell: shell.value,
        script,
        timeout_secs: 120,
      });
      setResult(out);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  };

  const blockedByRole = dashboardRole === "viewer";

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description="Runs PowerShell or cmd on this machine over the agent WebSocket. Requires ALLOW_REMOTE_SCRIPT_EXECUTION=true on the server. This is equivalent to arbitrary code execution: use only on trusted networks."
      >
        Remote script
      </Header>

      {dashboardRole === "viewer" && (
        <Alert type="info" header="Operator role required">
          Your account is a viewer. Ask an administrator to grant the <strong>operator</strong> role if you need to run
          remote scripts (operators and admins may run scripts when the server enables this feature).
        </Alert>
      )}

      {remoteOk === false && (
        <Alert type="warning" header="Remote scripting disabled">
          Set environment variable <code>ALLOW_REMOTE_SCRIPT_EXECUTION=true</code> on the Sentinel server, then restart
          the server, to enable this feature.
        </Alert>
      )}

      {err && (
        <Alert type="error" dismissible onDismiss={() => setErr(null)}>
          {err}
        </Alert>
      )}

      <FormField label="Shell">
        <Select
          selectedOption={shell}
          onChange={({ detail }) => {
            const o = detail.selectedOption;
            if (o?.value != null) {
              setShell({ label: o.label ?? String(o.value), value: String(o.value) });
            }
          }}
          options={[
            { label: "PowerShell", value: "powershell" },
            { label: "Command Prompt (cmd)", value: "cmd" },
          ]}
        />
      </FormField>

      <FormField
        label="Script"
        description={shell.value === "powershell" ? "PowerShell script body (saved to a temp .ps1 file)." : "For cmd, long or multi-line scripts are written to a temp .bat file."}
      >
        <textarea
          className="awsui-textarea"
          rows={14}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "13px", padding: "8px" }}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={running || remoteOk === false || blockedByRole}
          spellCheck={false}
        />
      </FormField>

      <Button
        variant="primary"
        loading={running}
        disabled={remoteOk === false || blockedByRole}
        onClick={() => void run()}
      >
        Run on this agent
      </Button>

      {result && (
        <SpaceBetween size="s">
          <Header variant="h3">Result</Header>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", margin: 0 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
