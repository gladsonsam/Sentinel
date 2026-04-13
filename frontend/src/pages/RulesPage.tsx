/**
 * Rules — unified management hub for all rule types.
 *
 * Tab 1 · Alert Rules    — URL / keystroke match rules (moved from /notifications)
 * Tab 2 · App Blocking   — kill-process rules
 * Tab 3 · Events         — cross-agent feed of alert matches + app block kills
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import Toggle from "@cloudscape-design/components/toggle";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { api, apiUrl } from "../lib/api";
import { fmtDateTime } from "../lib/utils";
import { AppIcon } from "../components/common/AppIcon";
import { AppBlockModal } from "../components/tabs/AppBlockModal";
import type {
  Agent,
  AgentGroup,
  AlertRule,
  AlertRuleChannel,
  AlertRuleMatchMode,
  AlertRuleScopeKind,
  AlertRuleScope,
  AppBlockRule,
  AppBlockEvent,
  InternetBlockRule,
} from "../lib/types";

// ── Shared helpers ────────────────────────────────────────────────────────────

type ScopeFormRow = { kind: AlertRuleScopeKind; group_id: string; agent_id: string };

function emptyScopeRow(): ScopeFormRow { return { kind: "all", group_id: "", agent_id: "" }; }

function scopesToForm(scopes: AlertRuleScope[]): ScopeFormRow[] {
  if (!scopes || scopes.length === 0) return [emptyScopeRow()];
  return scopes.map((s) => ({ kind: s.kind, group_id: s.group_id ?? "", agent_id: s.agent_id ?? "" }));
}

function formScopesToApi(rows: ScopeFormRow[]): AlertRuleScope[] {
  return rows.map((r) => {
    if (r.kind === "all") return { kind: "all" };
    if (r.kind === "group") return { kind: "group", group_id: r.group_id };
    return { kind: "agent", agent_id: r.agent_id };
  });
}

function scopeBadge(scopes?: AlertRuleScope[], groups?: AgentGroup[], agentsById?: Record<string, Agent>) {
  if (!scopes || scopes.length === 0) return <Badge color="grey">—</Badge>;
  const s = scopes[0];
  if (s.kind === "all") return <Badge color="red">All devices</Badge>;
  if (s.kind === "group") {
    const g = groups?.find((x) => x.id === s.group_id);
    return <Badge color="severity-medium">Group: {g?.name ?? s.group_id ?? "?"}</Badge>;
  }
  const a = s.agent_id ? agentsById?.[s.agent_id] : undefined;
  return <Badge color="blue">Agent: {a?.name ?? s.agent_id ?? "?"}</Badge>;
}

function appBlockScopeBadge(rule: AppBlockRule) {
  const kind = rule.scope_kind ?? rule.scopes?.[0]?.kind ?? "agent";
  if (kind === "all") return <Badge color="red">All devices</Badge>;
  if (kind === "group") return <Badge color="severity-medium">Group</Badge>;
  return <Badge color="blue">This device</Badge>;
}

// ── Screenshot preview ────────────────────────────────────────────────────────

function ScreenshotModal({ eventId, onClose }: { eventId: number | null; onClose: () => void }) {
  return (
    <Modal visible={eventId != null} onDismiss={onClose} header="Screenshot" size="max"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {eventId != null && <Button href={apiUrl(`/alert-rule-events/${eventId}/screenshot`)} target="_blank" iconName="external">Open</Button>}
            <Button variant="link" onClick={onClose}>Close</Button>
          </SpaceBetween>
        </Box>
      }>
      {eventId != null && (
        <div style={{ textAlign: "center" }}>
          <img src={apiUrl(`/alert-rule-events/${eventId}/screenshot`)} alt="screenshot"
            style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 6 }} />
        </div>
      )}
    </Modal>
  );
}

// ── Alert rule create/edit modal ──────────────────────────────────────────────

const CHANNEL_OPTIONS = [{ label: "URL", value: "url" }, { label: "Keystrokes", value: "keys" }];
const MATCH_OPTIONS = [{ id: "substring", text: "Substring" }, { id: "regex", text: "Regex" }];
const SCOPE_OPTIONS = [
  { label: "All agents", value: "all" },
  { label: "Agent group", value: "group" },
  { label: "Single agent", value: "agent" },
];

interface AlertRuleForm {
  name: string;
  channel: AlertRuleChannel;
  pattern: string;
  match_mode: AlertRuleMatchMode;
  case_insensitive: boolean;
  cooldown_secs: number;
  enabled: boolean;
  take_screenshot: boolean;
  scopes: ScopeFormRow[];
}

function defaultForm(): AlertRuleForm {
  return { name: "", channel: "url", pattern: "", match_mode: "substring", case_insensitive: true, cooldown_secs: 300, enabled: true, take_screenshot: false, scopes: [emptyScopeRow()] };
}

function AlertRuleFormModal({
  mode,
  form,
  groups,
  agents,
  error,
  onFormChange,
  onSave,
  onCancel,
  saving,
}: {
  mode: "create" | "edit";
  form: AlertRuleForm;
  groups: AgentGroup[];
  agents: Agent[];
  error: string | null;
  onFormChange: (f: AlertRuleForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const groupOptions = groups.map((g) => ({ label: g.name, value: g.id }));
  const agentOptions = agents.map((a) => ({ label: a.name, value: a.id }));

  const updateScope = (i: number, patch: Partial<ScopeFormRow>) => {
    const scopes = [...form.scopes];
    const cur = { ...scopes[i], ...patch };
    if (patch.kind === "all") { cur.group_id = ""; cur.agent_id = ""; }
    if (patch.kind === "group") cur.agent_id = "";
    if (patch.kind === "agent") cur.group_id = "";
    scopes[i] = cur;
    onFormChange({ ...form, scopes });
  };

  return (
    <Modal visible onDismiss={onCancel} size="large"
      header={mode === "create" ? "New alert rule" : "Edit alert rule"}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onSave} loading={saving}>Save</Button>
          </SpaceBetween>
        </Box>
      }>
      <SpaceBetween size="m">
        {error && <Box color="text-status-error">{error}</Box>}
        <ColumnLayout columns={2}>
          <FormField label="Name (optional)">
            <Input value={form.name} onChange={({ detail }) => onFormChange({ ...form, name: detail.value })} placeholder="e.g. YouTube block" />
          </FormField>
          <FormField label="Channel">
            <Select selectedOption={{ label: form.channel === "url" ? "URL" : "Keystrokes", value: form.channel }}
              options={CHANNEL_OPTIONS}
              onChange={({ detail }) => onFormChange({ ...form, channel: detail.selectedOption.value as AlertRuleChannel })} />
          </FormField>
        </ColumnLayout>
        <FormField label="Pattern" description={form.match_mode === "regex" ? "ECMAScript regular expression." : "Case-insensitive substring to match against."}>
          <Input value={form.pattern} onChange={({ detail }) => onFormChange({ ...form, pattern: detail.value })} placeholder={form.channel === "url" ? "e.g. youtube.com" : "e.g. password"} />
        </FormField>
        <ColumnLayout columns={2}>
          <FormField label="Match mode">
          <SegmentedControl selectedId={form.match_mode} options={MATCH_OPTIONS}
            onChange={({ detail }) => onFormChange({ ...form, match_mode: detail.selectedId as AlertRuleMatchMode })} />
          </FormField>
          <FormField label="Cooldown (seconds)" description="Min seconds between repeated matches.">
            <Input type="number" value={String(form.cooldown_secs)}
              onChange={({ detail }) => onFormChange({ ...form, cooldown_secs: Math.max(0, parseInt(detail.value) || 0) })} />
          </FormField>
        </ColumnLayout>
        <SpaceBetween size="xs">
          <Checkbox checked={form.case_insensitive} onChange={({ detail }) => onFormChange({ ...form, case_insensitive: detail.checked })}>Case insensitive</Checkbox>
          <Checkbox checked={form.take_screenshot} onChange={({ detail }) => onFormChange({ ...form, take_screenshot: detail.checked })}>Take screenshot on trigger</Checkbox>
          <Checkbox checked={form.enabled} onChange={({ detail }) => onFormChange({ ...form, enabled: detail.checked })}>Enabled</Checkbox>
        </SpaceBetween>
        <FormField label="Scope" description="Which agents this rule monitors.">
          <SpaceBetween size="xs">
            {form.scopes.map((s, i) => (
              <SpaceBetween key={i} direction="horizontal" size="xs" alignItems="center">
                <Select selectedOption={SCOPE_OPTIONS.find((o) => o.value === s.kind) ?? SCOPE_OPTIONS[0]}
                  options={SCOPE_OPTIONS}
                  onChange={({ detail }) => updateScope(i, { kind: detail.selectedOption.value as AlertRuleScopeKind })} />
                {s.kind === "group" && (
                  <Select placeholder="Select group" selectedOption={groupOptions.find((o) => o.value === s.group_id) ?? null}
                    options={groupOptions}
                    onChange={({ detail }) => updateScope(i, { group_id: detail.selectedOption.value })} />
                )}
                {s.kind === "agent" && (
                  <Select placeholder="Select agent" selectedOption={agentOptions.find((o) => o.value === s.agent_id) ?? null}
                    options={agentOptions}
                    onChange={({ detail }) => updateScope(i, { agent_id: detail.selectedOption.value })} />
                )}
                {form.scopes.length > 1 && (
                  <Button variant="inline-icon" iconName="remove" onClick={() => {
                    const scopes = form.scopes.filter((_, j) => j !== i);
                    onFormChange({ ...form, scopes });
                  }} />
                )}
              </SpaceBetween>
            ))}
            <Button variant="inline-link" iconName="add-plus" onClick={() => onFormChange({ ...form, scopes: [...form.scopes, emptyScopeRow()] })}>
              Add scope
            </Button>
          </SpaceBetween>
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

// ── Alert Rules tab ───────────────────────────────────────────────────────────

interface AlertRuleHistoryRow {
  id: number;
  agent_id: string;
  agent_name: string;
  snippet: string;
  has_screenshot: boolean;
  created_at: string;
}

function AlertRulesTab({ groups, agents }: { groups: AgentGroup[]; agents: Agent[] }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [ruleModal, setRuleModal] = useState<null | { mode: "create" } | { mode: "edit"; rule: AlertRule }>(null);
  const [ruleForm, setRuleForm] = useState<AlertRuleForm>(defaultForm());
  const [deleteRule, setDeleteRule] = useState<AlertRule | null>(null);
  const [historyRule, setHistoryRule] = useState<AlertRule | null>(null);
  const [historyEvents, setHistoryEvents] = useState<AlertRuleHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewEventId, setPreviewEventId] = useState<number | null>(null);

  const agentsById = useMemo(() => {
    const m: Record<string, Agent> = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.alertRulesList();
      setRules(data.rules ?? []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setRuleForm(defaultForm()); setRuleModal({ mode: "create" }); };
  const openEdit = (r: AlertRule) => { setRuleForm({ name: r.name, channel: r.channel, pattern: r.pattern, match_mode: r.match_mode, case_insensitive: r.case_insensitive, cooldown_secs: r.cooldown_secs, enabled: r.enabled, take_screenshot: Boolean(r.take_screenshot), scopes: scopesToForm(r.scopes ?? []) }); setRuleModal({ mode: "edit", rule: r }); };

  const saveRule = async () => {
    if (!ruleModal) return;
    const pattern = ruleForm.pattern.trim();
    if (!pattern) { setError("Pattern is required"); return; }
    setSaving(true); setError(null);
    try {
      const body = { name: ruleForm.name.trim(), channel: ruleForm.channel, pattern, match_mode: ruleForm.match_mode, case_insensitive: ruleForm.case_insensitive, cooldown_secs: ruleForm.cooldown_secs, enabled: ruleForm.enabled, take_screenshot: ruleForm.take_screenshot, scopes: formScopesToApi(ruleForm.scopes).map((s) => ({ kind: s.kind, group_id: s.group_id, agent_id: s.agent_id })) };
      if (ruleModal.mode === "create") await api.alertRulesCreate(body);
      else await api.alertRulesUpdate(ruleModal.rule.id, body);
      setRuleModal(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const openHistory = async (r: AlertRule) => {
    setHistoryRule(r);
    setHistoryLoading(true);
    try {
      const data = await api.alertRuleEvents(r.id, { limit: 200 });
      setHistoryEvents((data.rows ?? []).map((row: Record<string, unknown>) => ({
        id: Number(row.id), agent_id: String(row.agent_id ?? ""), agent_name: String(row.agent_name ?? ""),
        snippet: String(row.snippet ?? ""), has_screenshot: Boolean(row.has_screenshot), created_at: String(row.created_at ?? ""),
      })));
    } finally { setHistoryLoading(false); }
  };

  const { items: displayed, collectionProps, filterProps, paginationProps } = useCollection(rules, {
    filtering: { empty: "No rules", noMatch: "No matches", filteringFunction: (r, t) => r.name.toLowerCase().includes(t.toLowerCase()) || r.pattern.toLowerCase().includes(t.toLowerCase()) },
    pagination: { pageSize: 50 },
    sorting: {},
  });

  return (
    <>
      {error && <Box color="text-status-error" padding={{ bottom: "s" }}>{error}</Box>}

      <Table
        {...collectionProps}
        loading={loading}
        loadingText="Loading…"
        items={displayed}
        variant="container"
        stickyHeader
        header={
          <Header counter={`(${rules.length})`} actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="primary" iconName="add-plus" onClick={openCreate}>New rule</Button>
            </SpaceBetween>
          }>Alert Rules</Header>
        }
        filter={<TextFilter {...filterProps} filteringPlaceholder="Search rules…" />}
        pagination={<Pagination {...paginationProps} />}
        empty={<Box textAlign="center" padding="l" color="text-body-secondary">No alert rules yet. Create one to start monitoring URLs or keystrokes.</Box>}
        columnDefinitions={[
          { id: "name", header: "Name", cell: (r) => r.name || <Box color="text-body-secondary">—</Box>, sortingField: "name", width: "20%" },
          { id: "channel", header: "Channel", cell: (r) => <Badge color={r.channel === "url" ? "blue" : "grey"}>{r.channel === "url" ? "URL" : "Keys"}</Badge>, width: 80 },
          { id: "pattern", header: "Pattern", cell: (r) => <Box fontSize="body-s"><span style={{ fontFamily: "monospace" }}>{r.pattern}</span></Box>, width: "25%" },
          { id: "scope", header: "Scope", cell: (r) => scopeBadge(r.scopes, groups, agentsById), width: "20%" },
          { id: "enabled", header: "Active", cell: (r) => <Toggle checked={r.enabled} onChange={() => { void api.alertRulesUpdate(r.id, { name: r.name, channel: r.channel, pattern: r.pattern, match_mode: r.match_mode, case_insensitive: r.case_insensitive, cooldown_secs: r.cooldown_secs, enabled: !r.enabled, take_screenshot: r.take_screenshot, scopes: (r.scopes ?? []).map((s) => ({ kind: s.kind, group_id: s.group_id, agent_id: s.agent_id })) }).then(load); }} />, width: 80 },
          {
            id: "actions", header: "", width: 100,
            cell: (r) => (
              <ButtonDropdown
                variant="inline-icon"
                expandToViewport
                items={[{ id: "history", text: "Event history" }, { id: "edit", text: "Edit" }, { id: "delete", text: "Delete" }]}
                onItemClick={({ detail }) => {
                  if (detail.id === "history") void openHistory(r);
                  if (detail.id === "edit") openEdit(r);
                  if (detail.id === "delete") setDeleteRule(r);
                }} />
            ),
          },
        ]}
      />

      {/* Create/edit modal */}
      {ruleModal && (
        <AlertRuleFormModal mode={ruleModal.mode} form={ruleForm} groups={groups} agents={agents} error={error} saving={saving}
          onFormChange={setRuleForm} onSave={() => void saveRule()} onCancel={() => { setRuleModal(null); setError(null); }} />
      )}

      {/* Delete confirm */}
      <Modal visible={deleteRule != null} onDismiss={() => setDeleteRule(null)} header="Delete rule"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteRule(null)}>Cancel</Button>
              <Button variant="primary" onClick={async () => { if (!deleteRule) return; await api.alertRulesDelete(deleteRule.id); setDeleteRule(null); await load(); }}>Delete</Button>
            </SpaceBetween>
          </Box>
        }>
        Delete rule <strong>{deleteRule?.name || deleteRule?.pattern}</strong>? This cannot be undone.
      </Modal>

      {/* History modal */}
      {historyRule && (
        <Modal visible onDismiss={() => setHistoryRule(null)} size="large" header={`History — ${historyRule.name || historyRule.pattern}`}>
          <Table loading={historyLoading} loadingText="Loading…" items={historyEvents} variant="embedded"
            empty={<Box textAlign="center" padding="l" color="text-body-secondary">No events yet.</Box>}
            columnDefinitions={[
              { id: "time", header: "Time", cell: (r) => fmtDateTime(r.created_at), width: 170 },
              { id: "agent", header: "Agent", cell: (r) => r.agent_name, width: 180 },
              { id: "snippet", header: "Matched", cell: (r) => <Box fontSize="body-s"><span style={{ fontFamily: "monospace" }}>{r.snippet || "—"}</span></Box> },
              { id: "shot", header: "Screenshot", width: 110, cell: (r) => r.has_screenshot ? <Button variant="inline-link" iconName="zoom-to-fit" onClick={() => setPreviewEventId(r.id)}>View</Button> : <Box color="text-body-secondary" fontSize="body-s">—</Box> },
            ]} />
        </Modal>
      )}

      <ScreenshotModal eventId={previewEventId} onClose={() => setPreviewEventId(null)} />
    </>
  );
}

// ── App Blocking tab ──────────────────────────────────────────────────────────

function AppBlockingTab({ agents }: { agents: Agent[] }) {
  const [rules, setRules] = useState<AppBlockRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [historyRule, setHistoryRule] = useState<AppBlockRule | null>(null);
  const [historyEvents, setHistoryEvents] = useState<AppBlockEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.appBlockRulesList();
      setRules(data.rules ?? []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openHistory = async (r: AppBlockRule) => {
    setHistoryRule(r);
    setHistoryLoading(true);
    try {
      const data = await api.appBlockEventsForRule(r.id, { limit: 200 });
      setHistoryEvents(data.rows);
    } catch { setHistoryEvents([]); }
    finally { setHistoryLoading(false); }
  };

  const toggleRule = (r: AppBlockRule) => {
    setTogglingId(r.id);
    api.appBlockRulesUpdate(r.id, { enabled: !r.enabled })
      .then(() => setRules((prev) => prev.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x)))
      .catch((e) => setError(String(e)))
      .finally(() => setTogglingId(null));
  };

  const deleteRule = async (r: AppBlockRule) => {
    if (!confirm(`Delete block rule "${r.name || r.exe_pattern}"?`)) return;
    try { await api.appBlockRulesDelete(r.id); setRules((prev) => prev.filter((x) => x.id !== r.id)); }
    catch (e) { setError(String(e)); }
  };

  const { items: displayed, collectionProps, filterProps, paginationProps } = useCollection(rules, {
    filtering: { empty: "No rules", noMatch: "No matches", filteringFunction: (r, t) => r.exe_pattern.toLowerCase().includes(t.toLowerCase()) || (r.name || "").toLowerCase().includes(t.toLowerCase()) },
    pagination: { pageSize: 50 },
    sorting: {},
  });

  // Use first agent as context for "known exes" if available (admin view picks any)
  const contextAgentId = agents[0]?.id ?? "";

  return (
    <>
      {error && <Box color="text-status-error" padding={{ bottom: "s" }}>{error}</Box>}

      <Table
        {...collectionProps}
        loading={loading}
        loadingText="Loading…"
        items={displayed}
        variant="container"
        stickyHeader
        header={
          <Header counter={`(${rules.length})`} actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="primary" iconName="add-plus" onClick={() => setShowModal(true)}>New rule</Button>
            </SpaceBetween>
          }>App Blocking</Header>
        }
        filter={<TextFilter {...filterProps} filteringPlaceholder="Search rules…" />}
        pagination={<Pagination {...paginationProps} />}
        empty={<Box textAlign="center" padding="l" color="text-body-secondary">No app block rules yet.</Box>}
        columnDefinitions={[
          {
            id: "exe", header: "EXE name",
            cell: (r) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {contextAgentId && <AppIcon agentId={contextAgentId} exeName={r.exe_pattern} size={18} />}
                <Box fontSize="body-s"><span style={{ fontFamily: "monospace" }}>{r.exe_pattern}</span></Box>
                <Badge color="grey">{r.match_mode}</Badge>
              </div>
            ),
            width: "35%",
          },
          { id: "name", header: "Label", cell: (r) => r.name || <Box color="text-body-secondary">—</Box>, width: "20%" },
          { id: "scope", header: "Scope", cell: (r) => appBlockScopeBadge(r), width: 150 },
          { id: "enabled", header: "Active", cell: (r) => <Toggle checked={r.enabled} disabled={togglingId === r.id} onChange={() => toggleRule(r)} />, width: 80 },
          {
            id: "actions", header: "", width: 100,
            cell: (r) => (
              <ButtonDropdown
                variant="inline-icon"
                expandToViewport
                items={[{ id: "history", text: "Kill history" }, { id: "delete", text: "Delete" }]}
                onItemClick={({ detail }) => {
                  if (detail.id === "history") void openHistory(r);
                  if (detail.id === "delete") void deleteRule(r);
                }} />
            ),
          },
        ]}
      />

      {/* Add rule modal — open with no agent context, scope defaults to "all" */}
      <AppBlockModal
        visible={showModal}
        agentId={contextAgentId}
        agentName="all devices"
        onDismiss={() => setShowModal(false)}
        onCreated={() => { setShowModal(false); void load(); }}
      />

      {/* History modal */}
      {historyRule && (
        <Modal visible onDismiss={() => setHistoryRule(null)} size="large" header={`Kill history — ${historyRule.name || historyRule.exe_pattern}`}>
          <Table loading={historyLoading} loadingText="Loading…" items={historyEvents} variant="embedded"
            empty={<Box textAlign="center" padding="l" color="text-body-secondary">No kills recorded yet.</Box>}
            columnDefinitions={[
              { id: "time", header: "Time", cell: (r) => fmtDateTime(r.killed_at), width: 170 },
              { id: "agent", header: "Agent", cell: (r) => r.agent_name, width: 180 },
              { id: "exe", header: "EXE", cell: (r) => <Box fontSize="body-s"><span style={{ fontFamily: "monospace" }}>{r.exe_name}</span></Box> },
            ]} />
        </Modal>
      )}
    </>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

type EventFilter = "all" | "alerts" | "appblock";

interface UnifiedEvent {
  id: string;
  type: "alert" | "appblock";
  agent_id: string;
  agent_name: string;
  rule_name: string;
  detail: string;
  time: string;
  screenshot_id?: number;
  has_screenshot?: boolean;
}

// ── Internet Access tab ───────────────────────────────────────────────────────

type InetScopeFormRow = { kind: "all" | "group" | "agent"; group_id: string; agent_id: string };

function emptyInetScope(): InetScopeFormRow { return { kind: "all", group_id: "", agent_id: "" }; }

function InternetAccessTab({ groups, agents }: { groups: AgentGroup[]; agents: Agent[] }) {
  const [rules, setRules] = useState<InternetBlockRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScopes, setCreateScopes] = useState<InetScopeFormRow[]>([emptyInetScope()]);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const groupOptions = groups.map((g) => ({ label: g.name, value: g.id }));
  const agentOptions = agents.map((a) => ({ label: a.name, value: a.id }));

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.internetBlockRulesList(); setRules(d.rules ?? []); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const inetScopeBadge = (r: InternetBlockRule) => {
    const s = r.scopes[0];
    if (!s) return <Badge color="grey">—</Badge>;
    if (s.kind === "all") return <Badge color="red">All devices</Badge>;
    if (s.kind === "group") {
      const g = groups.find((x) => x.id === s.group_id);
      return <Badge color="severity-medium">Group: {g?.name ?? "?"}</Badge>;
    }
    const a = agents.find((x) => x.id === s.agent_id);
    return <Badge color="blue">Agent: {a?.name ?? "?"}</Badge>;
  };

  const updateScope = (i: number, patch: Partial<InetScopeFormRow>) => {
    setCreateScopes((prev) => {
      const next = [...prev];
      const cur = { ...next[i], ...patch };
      if (patch.kind === "all") { cur.group_id = ""; cur.agent_id = ""; }
      if (patch.kind === "group") cur.agent_id = "";
      if (patch.kind === "agent") cur.group_id = "";
      next[i] = cur;
      return next;
    });
  };

  const createRule = async () => {
    setSaving(true); setError(null);
    try {
      await api.internetBlockRulesCreate({
        name: createName.trim(),
        scopes: createScopes.map((s) => ({ kind: s.kind, group_id: s.group_id || undefined, agent_id: s.agent_id || undefined })),
      });
      setShowCreate(false); setCreateName(""); setCreateScopes([emptyInetScope()]);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const toggleRule = (r: InternetBlockRule) => {
    setTogglingId(r.id);
    api.internetBlockRulesUpdate(r.id, { enabled: !r.enabled })
      .then(() => setRules((prev) => prev.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x)))
      .catch((e) => setError(String(e)))
      .finally(() => setTogglingId(null));
  };

  const deleteRule = async (r: InternetBlockRule) => {
    if (!confirm(`Delete rule "${r.name || "Internet block"}"?`)) return;
    try { await api.internetBlockRulesDelete(r.id); setRules((prev) => prev.filter((x) => x.id !== r.id)); }
    catch (e) { setError(String(e)); }
  };

  const SCOPE_OPTS = [{ label: "All agents", value: "all" }, { label: "Agent group", value: "group" }, { label: "Single agent", value: "agent" }];

  return (
    <>
      {error && <Box color="text-status-error" padding={{ bottom: "s" }}>{error}</Box>}

      <Table
        loading={loading}
        loadingText="Loading…"
        items={rules}
        variant="container"
        stickyHeader
        header={
          <Header counter={`(${rules.length})`} actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="primary" iconName="add-plus" onClick={() => setShowCreate(true)}>New rule</Button>
            </SpaceBetween>
          }>Internet Access</Header>
        }
        empty={<Box textAlign="center" padding="l" color="text-body-secondary">No internet block rules. Create one to restrict internet access for all devices, a group, or a specific device.</Box>}
        columnDefinitions={[
          { id: "name", header: "Name", cell: (r) => r.name || <Box color="text-body-secondary">Unnamed</Box>, width: "30%" },
          { id: "scope", header: "Scope", cell: (r) => inetScopeBadge(r), width: "25%" },
          { id: "enabled", header: "Active", cell: (r) => <Toggle checked={r.enabled} disabled={togglingId === r.id} onChange={() => toggleRule(r)} />, width: 80 },
          { id: "created", header: "Created", cell: (r) => fmtDateTime(r.created_at), width: 170 },
          { id: "actions", header: "", width: 80, cell: (r) => <Button variant="inline-icon" iconName="remove" ariaLabel="Delete" onClick={() => void deleteRule(r)} /> },
        ]}
      />

      {/* Create modal */}
      <Modal visible={showCreate} onDismiss={() => setShowCreate(false)} header="New internet block rule"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void createRule()} loading={saving}>Create</Button>
            </SpaceBetween>
          </Box>
        }>
        <SpaceBetween size="m">
          {error && <Box color="text-status-error">{error}</Box>}
          <FormField label="Name (optional)">
            <Input value={createName} onChange={({ detail }) => setCreateName(detail.value)} placeholder="e.g. Block school devices" />
          </FormField>
          <FormField label="Scope" description="Who this rule blocks.">
            <SpaceBetween size="xs">
              {createScopes.map((s, i) => (
                <SpaceBetween key={i} direction="horizontal" size="xs" alignItems="center">
                  <Select selectedOption={SCOPE_OPTS.find((o) => o.value === s.kind) ?? SCOPE_OPTS[0]}
                    options={SCOPE_OPTS}
                    onChange={({ detail }) => updateScope(i, { kind: detail.selectedOption.value as InetScopeFormRow["kind"] })} />
                  {s.kind === "group" && (
                    <Select placeholder="Select group" selectedOption={groupOptions.find((o) => o.value === s.group_id) ?? null}
                      options={groupOptions}
                      onChange={({ detail }) => updateScope(i, { group_id: detail.selectedOption.value })} />
                  )}
                  {s.kind === "agent" && (
                    <Select placeholder="Select agent" selectedOption={agentOptions.find((o) => o.value === s.agent_id) ?? null}
                      options={agentOptions}
                      onChange={({ detail }) => updateScope(i, { agent_id: detail.selectedOption.value })} />
                  )}
                  {createScopes.length > 1 && (
                    <Button variant="inline-icon" iconName="remove" onClick={() => setCreateScopes((p) => p.filter((_, j) => j !== i))} />
                  )}
                </SpaceBetween>
              ))}
              <Button variant="inline-link" iconName="add-plus" onClick={() => setCreateScopes((p) => [...p, emptyInetScope()])}>Add scope</Button>
            </SpaceBetween>
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}

function EventsGlobalTab() {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [alertEvents, setAlertEvents] = useState<UnifiedEvent[]>([]);
  const [blockEvents, setBlockEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewEventId, setPreviewEventId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [alertData, blockData] = await Promise.all([
        api.alertRuleEventsAll({ limit: 500 }).catch(() => ({ rows: [] })),
        api.appBlockEventsAll({ limit: 500 }).catch(() => ({ rows: [] })),
      ]);

      setAlertEvents(
        (alertData.rows ?? []).map((r: Record<string, unknown>) => ({
          id: `a-${r.id}`,
          type: "alert" as const,
          agent_id: String(r.agent_id ?? ""),
          agent_name: String(r.agent_name ?? ""),
          rule_name: String(r.rule_name ?? ""),
          detail: String(r.snippet ?? ""),
          time: String(r.created_at ?? ""),
          screenshot_id: r.has_screenshot ? Number(r.id) : undefined,
          has_screenshot: Boolean(r.has_screenshot),
        })),
      );

      setBlockEvents(
        (blockData.rows).map((r) => ({
          id: `b-${r.id}`,
          type: "appblock" as const,
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          rule_name: r.rule_name ?? r.exe_name,
          detail: r.exe_name,
          time: r.killed_at,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allEvents = useMemo(() => {
    const src = filter === "all" ? [...alertEvents, ...blockEvents] : filter === "alerts" ? alertEvents : blockEvents;
    return src.sort((a, b) => b.time.localeCompare(a.time));
  }, [filter, alertEvents, blockEvents]);

  const { items: displayed, collectionProps, paginationProps } = useCollection(allEvents, {
    pagination: { pageSize: 50 },
    sorting: { defaultState: { sortingColumn: { sortingField: "time" }, isDescending: true } },
  });

  return (
    <>
      <Table
        {...collectionProps}
        loading={loading}
        loadingText="Loading…"
        items={displayed}
        variant="container"
        stickyHeader
        header={
          <Header counter={`(${allEvents.length})`} actions={
            <SpaceBetween direction="horizontal" size="xs">
              <SegmentedControl selectedId={filter} options={[{ id: "all", text: "All" }, { id: "alerts", text: "Alert" }, { id: "appblock", text: "App Block" }]}
                onChange={({ detail }) => setFilter(detail.selectedId as EventFilter)} />
            </SpaceBetween>
          }>Rule Events</Header>
        }
        pagination={<Pagination {...paginationProps} />}
        empty={<Box textAlign="center" padding="l" color="text-body-secondary">No events yet.</Box>}
        columnDefinitions={[
          { id: "time", header: "Time", cell: (r) => fmtDateTime(r.time), sortingField: "time", width: 170 },
          { id: "type", header: "Type", cell: (r) => <Badge color={r.type === "alert" ? "blue" : "red"}>{r.type === "alert" ? "Alert" : "App Block"}</Badge>, width: 110 },
          { id: "agent", header: "Agent", cell: (r) => r.agent_name, width: 180 },
          { id: "rule", header: "Rule", cell: (r) => r.rule_name || "—", width: 200 },
          { id: "detail", header: "Detail", cell: (r) => <Box fontSize="body-s"><span style={{ fontFamily: "monospace" }}>{r.detail || "—"}</span></Box> },
          { id: "shot", header: "Screenshot", width: 110, cell: (r) => r.has_screenshot && r.screenshot_id ? <Button variant="inline-link" iconName="zoom-to-fit" onClick={() => setPreviewEventId(r.screenshot_id!)}>View</Button> : <Box color="text-body-secondary" fontSize="body-s">—</Box> },
          {
            id: "timeline",
            header: "Timeline",
            width: 110,
            cell: (r) => (
              <Button
                variant="inline-link"
                iconName="angle-right"
                href={`/agents/${r.agent_id}?tab=activity&at=${encodeURIComponent(r.time)}`}
              >
                View
              </Button>
            ),
          },
        ]}
      />
      <ScreenshotModal eventId={previewEventId} onClose={() => setPreviewEventId(null)} />
    </>
  );
}

// ── Main RulesPage ────────────────────────────────────────────────────────────

type RulesTabId = "alert-rules" | "app-blocking" | "internet-access" | "events";

export function RulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as RulesTabId) ?? "alert-rules";

  const setTab = (id: RulesTabId) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("tab", id); return n; }, { replace: true });
  };

  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    void api.agentGroupsList().then((d) => setGroups(d.groups ?? [])).catch(() => {});
    void api.agents().then((d) => setAgents(d.agents ?? [])).catch(() => {});
  }, []);

  return (
    <ContentLayout header={<Header variant="h1" description="Manage alert rules, app blocking, and view all rule events across devices.">Rules</Header>}>
      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => setTab(detail.activeTabId as RulesTabId)}
        tabs={[
          { id: "alert-rules", label: "Alert Rules", content: <AlertRulesTab groups={groups} agents={agents} /> },
          { id: "app-blocking", label: "App Blocking", content: <AppBlockingTab agents={agents} /> },
          { id: "internet-access", label: "Internet Access", content: <InternetAccessTab groups={groups} agents={agents} /> },
          { id: "events", label: "Events", content: <EventsGlobalTab /> },
        ]}
      />
    </ContentLayout>
  );
}
