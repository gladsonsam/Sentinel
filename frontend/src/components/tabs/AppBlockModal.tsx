import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { api } from "../../lib/api";
import { AppIcon } from "../common/AppIcon";

interface AppBlockModalProps {
  visible: boolean;
  agentId: string;
  agentName: string;
  onDismiss: () => void;
  onCreated: () => void;
}

export function AppBlockModal({
  visible,
  agentId,
  agentName,
  onDismiss,
  onCreated,
}: AppBlockModalProps) {
  const [exePattern, setExePattern] = useState("");
  const [matchMode, setMatchMode] = useState<"contains" | "exact">("contains");
  const [label, setLabel] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [protectedExes, setProtectedExes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load known exe names and protected list once when the modal opens.
  useEffect(() => {
    if (!visible) return;
    setExePattern("");
    setMatchMode("contains");
    setLabel("");
    setApplyToAll(false);
    setError(null);

    api.agentKnownExes(agentId).then((r) => setSuggestions(r.exes)).catch(() => {});
    api.appBlockProtectedExes().then((r) => setProtectedExes(r.protected)).catch(() => {});
  }, [visible, agentId]);

  // Check if the current pattern would hit a protected exe.
  const protectedHit = (pattern: string, mode: "contains" | "exact"): string | null => {
    const pat = pattern.trim().toLowerCase();
    if (!pat) return null;
    for (const p of protectedExes) {
      const hit = mode === "exact" ? pat === p : p.includes(pat);
      if (hit) return p;
    }
    return null;
  };

  const handleCreate = () => {
    const pattern = exePattern.trim();
    if (!pattern) {
      setError("EXE name is required.");
      return;
    }
    const hit = protectedHit(pattern, matchMode);
    if (hit) {
      setError(`'${hit}' is a protected system process and cannot be blocked.`);
      return;
    }
    setSaving(true);
    setError(null);

    const scopes = applyToAll
      ? [{ kind: "all" as const }]
      : [{ kind: "agent" as const, agent_id: agentId }];

    api
      .appBlockRulesCreate({
        name: label.trim() || pattern,
        exe_pattern: pattern,
        match_mode: matchMode,
        scopes,
      })
      .then(() => {
        onCreated();
        onDismiss();
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false));
  };

  // Filter suggestions as user types, excluding protected exes.
  const filtered = exePattern.trim()
    ? suggestions.filter((s) =>
        s.toLowerCase().includes(exePattern.trim().toLowerCase()) &&
        !protectedExes.includes(s.toLowerCase()),
      )
    : suggestions.filter((s) => !protectedExes.includes(s.toLowerCase()));

  const liveProtectedHit = protectedHit(exePattern, matchMode);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Add app block rule"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              loading={saving}
              disabled={!!liveProtectedHit}
            >
              Add rule
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error && (
          <Box color="text-status-error" fontSize="body-s">
            {error}
          </Box>
        )}

        <FormField
          label="EXE name"
          description="The executable file name to block (e.g. tiktok.exe)."
        >
          <SpaceBetween size="xxs">
            <Input
              value={exePattern}
              onChange={({ detail }) => setExePattern(detail.value)}
              placeholder="e.g. tiktok.exe"
              autoFocus
            />
            {liveProtectedHit && (
              <Box color="text-status-error" fontSize="body-s">
                ⚠ '{liveProtectedHit}' is a protected system process and cannot be blocked.
              </Box>
            )}
            {!liveProtectedHit && filtered.length > 0 && (
              <div
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  border: "1px solid var(--color-border-divider-default)",
                  borderRadius: 4,
                  background: "var(--color-background-container-content)",
                }}
              >
                {filtered.slice(0, 50).map((s) => (
                  <div
                    key={s}
                    onClick={() => setExePattern(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background =
                        "var(--color-background-item-selected)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "")
                    }
                  >
                    <AppIcon agentId={agentId} exeName={s} size={16} />
                    <span style={{ fontFamily: "monospace" }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </SpaceBetween>
        </FormField>

        <FormField label="Match mode">
          <SegmentedControl
            selectedId={matchMode}
            onChange={({ detail }) =>
              setMatchMode(detail.selectedId as "contains" | "exact")
            }
            options={[
              { id: "contains", text: "Contains" },
              { id: "exact", text: "Exact" },
            ]}
          />
        </FormField>

        <FormField label="Label" description="Optional friendly name for this rule.">
          <Input
            value={label}
            onChange={({ detail }) => setLabel(detail.value)}
            placeholder="e.g. Block TikTok"
          />
        </FormField>

        <Checkbox
          checked={applyToAll}
          onChange={({ detail }) => setApplyToAll(detail.checked)}
        >
          Apply to all devices (not just {agentName})
        </Checkbox>
      </SpaceBetween>
    </Modal>
  );
}
