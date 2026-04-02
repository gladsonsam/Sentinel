import { useCallback, useEffect, useMemo, useState } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import Modal from "@cloudscape-design/components/modal";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Checkbox from "@cloudscape-design/components/checkbox";
import Box from "@cloudscape-design/components/box";
import Alert from "@cloudscape-design/components/alert";
import Tabs from "@cloudscape-design/components/tabs";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import { api } from "../lib/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type {
  Agent,
  AgentGroup,
  AlertRule,
  AlertRuleChannel,
  AlertRuleMatchMode,
  AlertRuleScope,
  AlertRuleScopeKind,
} from "../lib/types";

type ScopeFormRow = {
  kind: AlertRuleScopeKind;
  group_id: string;
  agent_id: string;
};

function emptyScopeRow(): ScopeFormRow {
  return { kind: "all", group_id: "", agent_id: "" };
}

function scopesToForm(scopes: AlertRuleScope[]): ScopeFormRow[] {
  if (scopes.length === 0) return [emptyScopeRow()];
  return scopes.map((s) => ({
    kind: s.kind,
    group_id: s.group_id ?? "",
    agent_id: s.agent_id ?? "",
  }));
}

function formScopesToApi(rows: ScopeFormRow[]): AlertRuleScope[] {
  return rows.map((r) => {
    if (r.kind === "all") return { kind: "all" };
    if (r.kind === "group") return { kind: "group", group_id: r.group_id };
    return { kind: "agent", agent_id: r.agent_id };
  });
}

function formatScopesLabel(
  scopes: AlertRuleScope[],
  groups: AgentGroup[],
  agentsById: Record<string, Agent>,
): string {
  return scopes
    .map((s) => {
      if (s.kind === "all") return "All agents";
      if (s.kind === "group") {
        const g = groups.find((x) => x.id === s.group_id);
        return `Group: ${g?.name ?? s.group_id ?? "?"}`;
      }
      const a = s.agent_id ? agentsById[s.agent_id] : undefined;
      return `Agent: ${a?.name ?? s.agent_id ?? "?"}`;
    })
    .join(" · ");
}

const CHANNEL_OPTIONS = [
  { label: "URL", value: "url" },
  { label: "Keystrokes", value: "keys" },
];

const MATCH_OPTIONS = [
  { label: "Substring", value: "substring" },
  { label: "Regex", value: "regex" },
];

const SCOPE_KIND_OPTIONS = [
  { label: "All agents", value: "all" },
  { label: "Agent group", value: "group" },
  { label: "Single agent", value: "agent" },
];

type MainTabId = "groups" | "rules";

export function NotificationsAdminPage() {
  const isNarrow = useMediaQuery("(max-width: 768px)");
  const [mainTab, setMainTab] = useState<MainTabId>("groups");
  const [groups, setGroups] = useState<AgentGroup[] | null>(null);
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [agentsList, setAgentsList] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupModal, setGroupModal] = useState<null | { mode: "create" } | { mode: "edit"; g: AgentGroup }>(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });

  const [membersModal, setMembersModal] = useState<null | { group: AgentGroup; memberIds: string[] }>(null);
  const [addAgentId, setAddAgentId] = useState<string>("");

  const [ruleModal, setRuleModal] = useState<null | { mode: "create" } | { mode: "edit"; rule: AlertRule }>(null);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    channel: "url" as AlertRuleChannel,
    pattern: "",
    match_mode: "substring" as AlertRuleMatchMode,
    case_insensitive: true,
    cooldown_secs: 300,
    enabled: true,
    scopes: [emptyScopeRow()] as ScopeFormRow[],
  });

  const [deleteGroup, setDeleteGroup] = useState<AgentGroup | null>(null);
  const [deleteRule, setDeleteRule] = useState<AlertRule | null>(null);

  const agentsById = useMemo(() => {
    const m: Record<string, Agent> = {};
    for (const a of agentsList) m[a.id] = a;
    return m;
  }, [agentsList]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, r, a] = await Promise.all([
        api.agentGroupsList(),
        api.alertRulesList(),
        api.agents(),
      ]);
      setGroups(g.groups);
      setRules(r.rules);
      setAgentsList(a.agents);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
      setGroups(null);
      setRules(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const agentOptions = useMemo(
    () =>
      [...agentsList]
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((a) => ({ label: `${a.name} (${a.id.slice(0, 8)}…)`, value: a.id })),
    [agentsList],
  );

  const groupOptions = useMemo(
    () => groups?.map((g) => ({ label: g.name, value: g.id })) ?? [],
    [groups],
  );

  const openCreateGroup = () => {
    setGroupForm({ name: "", description: "" });
    setGroupModal({ mode: "create" });
  };

  const openEditGroup = (g: AgentGroup) => {
    setGroupForm({ name: g.name, description: g.description ?? "" });
    setGroupModal({ mode: "edit", g });
  };

  const saveGroup = async () => {
    if (!groupModal) return;
    const name = groupForm.name.trim();
    if (!name) {
      setError("Group name is required");
      return;
    }
    setError(null);
    try {
      if (groupModal.mode === "create") {
        await api.agentGroupsCreate({ name, description: groupForm.description.trim() });
      } else {
        await api.agentGroupsUpdate(groupModal.g.id, {
          name,
          description: groupForm.description.trim(),
        });
      }
      setGroupModal(null);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const openMembers = async (g: AgentGroup) => {
    setError(null);
    try {
      const { agent_ids } = await api.agentGroupMembers(g.id);
      setMembersModal({ group: g, memberIds: agent_ids });
      setAddAgentId("");
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const addMember = async () => {
    if (!membersModal || !addAgentId) return;
    setError(null);
    try {
      await api.agentGroupMembersAdd(membersModal.group.id, { agent_ids: [addAgentId] });
      const { agent_ids } = await api.agentGroupMembers(membersModal.group.id);
      setMembersModal({ ...membersModal, memberIds: agent_ids });
      setAddAgentId("");
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const removeMember = async (agentId: string) => {
    if (!membersModal) return;
    setError(null);
    try {
      await api.agentGroupMemberRemove(membersModal.group.id, agentId);
      const { agent_ids } = await api.agentGroupMembers(membersModal.group.id);
      setMembersModal({ ...membersModal, memberIds: agent_ids });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroup) return;
    setError(null);
    try {
      await api.agentGroupsDelete(deleteGroup.id);
      setDeleteGroup(null);
      setMembersModal(null);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const openCreateRule = () => {
    setRuleForm({
      name: "",
      channel: "url",
      pattern: "",
      match_mode: "substring",
      case_insensitive: true,
      cooldown_secs: 300,
      enabled: true,
      scopes: [emptyScopeRow()],
    });
    setRuleModal({ mode: "create" });
  };

  const openEditRule = (rule: AlertRule) => {
    setRuleForm({
      name: rule.name,
      channel: rule.channel,
      pattern: rule.pattern,
      match_mode: rule.match_mode,
      case_insensitive: rule.case_insensitive,
      cooldown_secs: rule.cooldown_secs,
      enabled: rule.enabled,
      scopes: scopesToForm(rule.scopes),
    });
    setRuleModal({ mode: "edit", rule });
  };

  const saveRule = async () => {
    if (!ruleModal) return;
    const pattern = ruleForm.pattern.trim();
    if (!pattern) {
      setError("Pattern is required");
      return;
    }
    for (const row of ruleForm.scopes) {
      if (row.kind === "group" && !row.group_id.trim()) {
        setError("Each group scope must select a group");
        return;
      }
      if (row.kind === "agent" && !row.agent_id.trim()) {
        setError("Each agent scope must select an agent");
        return;
      }
    }
    const scopes = formScopesToApi(ruleForm.scopes);
    setError(null);
    try {
      const body = {
        name: ruleForm.name.trim(),
        channel: ruleForm.channel,
        pattern,
        match_mode: ruleForm.match_mode,
        case_insensitive: ruleForm.case_insensitive,
        cooldown_secs: ruleForm.cooldown_secs,
        enabled: ruleForm.enabled,
        scopes: scopes.map((s) => ({
          kind: s.kind,
          group_id: s.group_id,
          agent_id: s.agent_id,
        })),
      };
      if (ruleModal.mode === "create") {
        await api.alertRulesCreate(body);
      } else {
        await api.alertRulesUpdate(ruleModal.rule.id, body);
      }
      setRuleModal(null);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const confirmDeleteRule = async () => {
    if (!deleteRule) return;
    setError(null);
    try {
      await api.alertRulesDelete(deleteRule.id);
      setDeleteRule(null);
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const updateScopeRow = (index: number, patch: Partial<ScopeFormRow>) => {
    setRuleForm((prev) => {
      const scopes = [...prev.scopes];
      const cur = { ...scopes[index], ...patch };
      if (patch.kind === "all") {
        cur.group_id = "";
        cur.agent_id = "";
      }
      if (patch.kind === "group") {
        cur.agent_id = "";
      }
      if (patch.kind === "agent") {
        cur.group_id = "";
      }
      scopes[index] = cur;
      return { ...prev, scopes };
    });
  };

  const addScopeRow = () => {
    setRuleForm((prev) => ({ ...prev, scopes: [...prev.scopes, emptyScopeRow()] }));
  };

  const removeScopeRow = (index: number) => {
    setRuleForm((prev) => {
      if (prev.scopes.length <= 1) return prev;
      const scopes = prev.scopes.filter((_, i) => i !== index);
      return { ...prev, scopes };
    });
  };

  const addableAgents = useMemo(() => {
    if (!membersModal) return agentOptions;
    const set = new Set(membersModal.memberIds);
    return agentOptions.filter((o) => !set.has(o.value));
  }, [membersModal, agentOptions]);

  const groupRowActions = (): ButtonDropdownProps.ItemOrGroup[] => [
    { id: "members", text: "Members" },
    { id: "rename", text: "Rename" },
    { id: "delete", text: "Delete" },
  ];

  const ruleRowActions = (): ButtonDropdownProps.ItemOrGroup[] => [
    { id: "edit", text: "Edit" },
    { id: "delete", text: "Delete" },
  ];

  const onGroupAction = (g: AgentGroup, id: string) => {
    if (id === "members") void openMembers(g);
    else if (id === "rename") openEditGroup(g);
    else if (id === "delete") setDeleteGroup(g);
  };

  const onRuleAction = (r: AlertRule, id: string) => {
    if (id === "edit") openEditRule(r);
    else if (id === "delete") setDeleteRule(r);
  };

  const groupItems = groups ?? [];
  const ruleItems = rules ?? [];

  const headerActions = (
    <Button iconName="refresh" onClick={() => void load()} loading={loading}>
      Refresh
    </Button>
  );

  const mobileToolbar = (
    <div className="sentinel-users-toolbar-mobile">
      {headerActions}
      {mainTab === "groups" ? (
        <Button onClick={openCreateGroup}>Create group</Button>
      ) : (
        <Button variant="primary" onClick={openCreateRule}>
          Create alert rule
        </Button>
      )}
    </div>
  );

  const groupsPanel = (
    <SpaceBetween size="l">
      <Box variant="p" color="text-body-secondary">
        Create groups of agents, then attach alert rules to <b>all agents</b>, a <b>group</b>, or a{" "}
        <b>single agent</b> under Alert rules. Matches surface in the dashboard when telemetry arrives.
      </Box>
      {!isNarrow && <Button onClick={openCreateGroup}>Create group</Button>}
      {isNarrow ? (
        loading && groupItems.length === 0 ? (
          <Box color="text-body-secondary">Loading groups…</Box>
        ) : groupItems.length === 0 ? (
          <Box color="text-body-secondary">No groups yet.</Box>
        ) : (
          <SpaceBetween size="m">
            {groupItems.map((g) => (
              <Box key={g.id} variant="div" className="sentinel-users-mobile-card">
                <SpaceBetween size="s">
                  <Box variant="h3" tagOverride="div" fontSize="heading-m">
                    {g.name}
                  </Box>
                  <Box color="text-body-secondary">{g.description || "—"}</Box>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {g.member_count} member{g.member_count === 1 ? "" : "s"}
                  </Box>
                  <div className="sentinel-users-manage-slot">
                    <ButtonDropdown
                      variant="primary"
                      items={groupRowActions()}
                      expandToViewport
                      onItemClick={({ detail }) => onGroupAction(g, detail.id)}
                    >
                      Manage
                    </ButtonDropdown>
                  </div>
                </SpaceBetween>
              </Box>
            ))}
          </SpaceBetween>
        )
      ) : (
        <Table
          columnDefinitions={[
            { id: "name", header: "Name", cell: (g) => g.name },
            { id: "desc", header: "Description", cell: (g) => g.description || "—" },
            { id: "n", header: "Members", cell: (g) => String(g.member_count) },
            {
              id: "act",
              header: "",
              cell: (g) => (
                <ButtonDropdown
                  variant="normal"
                  items={groupRowActions()}
                  expandToViewport
                  onItemClick={({ detail }) => onGroupAction(g, detail.id)}
                >
                  Manage
                </ButtonDropdown>
              ),
            },
          ]}
          items={groupItems}
          loading={loading}
          loadingText="Loading groups"
          empty={<Box color="text-body-secondary">No groups yet.</Box>}
          variant="embedded"
        />
      )}
    </SpaceBetween>
  );

  const rulesPanel = (
    <SpaceBetween size="l">
      <Box variant="p" color="text-body-secondary">
        Rules use substring or regex against the active <b>URL</b> or batched <b>keystroke</b> text. Use{" "}
        <b>cooldown</b> to avoid spamming the same match. Scopes can be combined (e.g. all agents + one extra
        group).
      </Box>
      {!isNarrow && (
        <Button variant="primary" onClick={openCreateRule}>
          Create alert rule
        </Button>
      )}
      {isNarrow ? (
        loading && ruleItems.length === 0 ? (
          <Box color="text-body-secondary">Loading rules…</Box>
        ) : ruleItems.length === 0 ? (
          <Box color="text-body-secondary">No alert rules yet.</Box>
        ) : (
          <SpaceBetween size="m">
            {ruleItems.map((r) => (
              <Box key={r.id} variant="div" className="sentinel-users-mobile-card">
                <SpaceBetween size="s">
                  <Box variant="h3" tagOverride="div" fontSize="heading-m">
                    {r.name || `Rule #${r.id}`}
                  </Box>
                  <Box color="text-body-secondary">
                    {r.channel} · {r.match_mode} · cooldown {r.cooldown_secs}s · {r.enabled ? "On" : "Off"}
                  </Box>
                  <Box fontSize="body-s" className="sentinel-wrap-anywhere">
                    {r.pattern}
                  </Box>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {formatScopesLabel(r.scopes, groups ?? [], agentsById)}
                  </Box>
                  <div className="sentinel-users-manage-slot">
                    <ButtonDropdown
                      variant="primary"
                      items={ruleRowActions()}
                      expandToViewport
                      onItemClick={({ detail }) => onRuleAction(r, detail.id)}
                    >
                      Manage
                    </ButtonDropdown>
                  </div>
                </SpaceBetween>
              </Box>
            ))}
          </SpaceBetween>
        )
      ) : (
        <Table
          columnDefinitions={[
            { id: "name", header: "Name", cell: (r) => r.name || `Rule #${r.id}` },
            { id: "ch", header: "Channel", cell: (r) => r.channel },
            { id: "pat", header: "Pattern", cell: (r) => <Box className="sentinel-wrap-anywhere">{r.pattern}</Box> },
            { id: "mode", header: "Match", cell: (r) => r.match_mode },
            { id: "cd", header: "Cooldown (s)", cell: (r) => String(r.cooldown_secs) },
            { id: "en", header: "On", cell: (r) => (r.enabled ? "Yes" : "No") },
            {
              id: "scopes",
              header: "Scopes",
              cell: (r) => formatScopesLabel(r.scopes, groups ?? [], agentsById),
            },
            {
              id: "act",
              header: "",
              cell: (r) => (
                <ButtonDropdown
                  variant="normal"
                  items={ruleRowActions()}
                  expandToViewport
                  onItemClick={({ detail }) => onRuleAction(r, detail.id)}
                >
                  Manage
                </ButtonDropdown>
              ),
            },
          ]}
          items={ruleItems}
          loading={loading}
          loadingText="Loading rules"
          empty={<Box color="text-body-secondary">No alert rules yet.</Box>}
          variant="embedded"
        />
      )}
    </SpaceBetween>
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Admin: URL and keystroke patterns that trigger in-dashboard notifications. Scoped globally, by agent group, or per agent."
          actions={isNarrow ? undefined : headerActions}
        >
          Notifications
        </Header>
      }
    >
      <div className="sentinel-notify-page">
        <SpaceBetween size="l">
          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {isNarrow && mobileToolbar}

          {isNarrow ? (
            <SpaceBetween size="m">
              <SegmentedControl
                className="sentinel-notify-view-toggle"
                label="View"
                selectedId={mainTab}
                options={[
                  { id: "groups", text: "Agent groups" },
                  { id: "rules", text: "Alert rules" },
                ]}
                onChange={({ detail }) => setMainTab(detail.selectedId as MainTabId)}
              />
              {mainTab === "groups" ? groupsPanel : rulesPanel}
            </SpaceBetween>
          ) : (
            <Tabs
              activeTabId={mainTab}
              onChange={({ detail }) => setMainTab(detail.activeTabId as MainTabId)}
              tabs={[
                { label: "Agent groups", id: "groups", content: groupsPanel },
                { label: "Alert rules", id: "rules", content: rulesPanel },
              ]}
            />
          )}
        </SpaceBetween>

      <Modal
        visible={Boolean(groupModal)}
        onDismiss={() => setGroupModal(null)}
        header={groupModal?.mode === "create" ? "Create agent group" : "Rename agent group"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setGroupModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveGroup()}>
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Name">
            <Input value={groupForm.name} onChange={({ detail }) => setGroupForm((p) => ({ ...p, name: detail.value }))} />
          </FormField>
          <FormField label="Description">
            <Input
              value={groupForm.description}
              onChange={({ detail }) => setGroupForm((p) => ({ ...p, description: detail.value }))}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={Boolean(membersModal)}
        onDismiss={() => setMembersModal(null)}
        header={membersModal ? `Members: ${membersModal.group.name}` : "Members"}
        size="large"
        footer={
          <Box float="right">
            <Button variant="link" onClick={() => setMembersModal(null)}>
              Close
            </Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Add agent">
            <div className="sentinel-notify-members-add">
              <SpaceBetween direction="horizontal" size="xs">
              <Select
                selectedOption={
                  addAgentId ? addableAgents.find((o) => o.value === addAgentId) ?? null : null
                }
                onChange={({ detail }) => {
                  const v = detail.selectedOption?.value;
                  setAddAgentId(typeof v === "string" ? v : "");
                }}
                options={addableAgents}
                placeholder="Choose an agent"
                filteringType="auto"
                empty="No agents available to add"
              />
              <Button disabled={!addAgentId} onClick={() => void addMember()}>
                Add
              </Button>
              </SpaceBetween>
            </div>
          </FormField>
          {isNarrow ? (
            (membersModal?.memberIds.length ?? 0) === 0 ? (
              <Box color="text-body-secondary">No members in this group.</Box>
            ) : (
              <SpaceBetween size="m">
                {(membersModal?.memberIds ?? []).map((id) => (
                  <Box key={id} variant="div" className="sentinel-users-mobile-card">
                    <SpaceBetween size="s">
                      <Box fontSize="heading-s" fontWeight="bold">
                        {agentsById[id]?.name ?? id}
                      </Box>
                      <Button onClick={() => void removeMember(id)}>Remove from group</Button>
                    </SpaceBetween>
                  </Box>
                ))}
              </SpaceBetween>
            )
          ) : (
            <Table
              columnDefinitions={[
                {
                  id: "name",
                  header: "Agent",
                  cell: (id: string) => agentsById[id]?.name ?? id,
                },
                {
                  id: "rm",
                  header: "",
                  cell: (id: string) => (
                    <Button variant="link" onClick={() => void removeMember(id)}>
                      Remove
                    </Button>
                  ),
                },
              ]}
              items={membersModal?.memberIds ?? []}
              empty={<Box color="text-body-secondary">No members in this group.</Box>}
              variant="embedded"
            />
          )}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={Boolean(ruleModal)}
        onDismiss={() => setRuleModal(null)}
        header={ruleModal?.mode === "create" ? "Create alert rule" : "Edit alert rule"}
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setRuleModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveRule()}>
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Display name">
            <Input value={ruleForm.name} onChange={({ detail }) => setRuleForm((p) => ({ ...p, name: detail.value }))} />
          </FormField>
          <ColumnLayout columns={isNarrow ? 1 : 2}>
            <FormField label="Channel">
              <Select
                selectedOption={CHANNEL_OPTIONS.find((o) => o.value === ruleForm.channel)!}
                onChange={({ detail }) => {
                  const v = detail.selectedOption?.value as AlertRuleChannel | undefined;
                  if (v) setRuleForm((p) => ({ ...p, channel: v }));
                }}
                options={CHANNEL_OPTIONS}
              />
            </FormField>
            <FormField label="Match mode">
              <Select
                selectedOption={MATCH_OPTIONS.find((o) => o.value === ruleForm.match_mode)!}
                onChange={({ detail }) => {
                  const v = detail.selectedOption?.value as AlertRuleMatchMode | undefined;
                  if (v) setRuleForm((p) => ({ ...p, match_mode: v }));
                }}
                options={MATCH_OPTIONS}
              />
            </FormField>
          </ColumnLayout>
          <FormField
            label="Pattern"
            description={ruleForm.match_mode === "regex" ? "Rust regex; case sensitivity follows the checkbox below." : "Substring match."}
          >
            <Input value={ruleForm.pattern} onChange={({ detail }) => setRuleForm((p) => ({ ...p, pattern: detail.value }))} />
          </FormField>
          <div className="sentinel-notify-check-row">
            <SpaceBetween direction="horizontal" size="l">
              <Checkbox
                checked={ruleForm.case_insensitive}
                onChange={({ detail }) => setRuleForm((p) => ({ ...p, case_insensitive: detail.checked }))}
              >
                Case-insensitive
              </Checkbox>
              <Checkbox
                checked={ruleForm.enabled}
                onChange={({ detail }) => setRuleForm((p) => ({ ...p, enabled: detail.checked }))}
              >
                Enabled
              </Checkbox>
            </SpaceBetween>
          </div>
          <FormField label="Cooldown (seconds)" description="0 = fire every matching event (can be noisy).">
            <Input
              type="number"
              value={String(ruleForm.cooldown_secs)}
              onChange={({ detail }) => {
                const n = parseInt(detail.value, 10);
                setRuleForm((p) => ({ ...p, cooldown_secs: Number.isFinite(n) ? Math.max(0, n) : 0 }));
              }}
            />
          </FormField>

          <Header variant="h3">Scopes</Header>
          {ruleForm.scopes.map((row, index) => (
            <Box key={index} padding="s" className="sentinel-notify-scope-row">
              <SpaceBetween size="s">
                <SpaceBetween direction="horizontal" size="xs" alignItems="start">
                  <FormField label="Applies to">
                    <Select
                      selectedOption={SCOPE_KIND_OPTIONS.find((o) => o.value === row.kind)!}
                      onChange={({ detail }) => {
                        const v = detail.selectedOption?.value as AlertRuleScopeKind | undefined;
                        if (v) updateScopeRow(index, { kind: v });
                      }}
                      options={SCOPE_KIND_OPTIONS}
                    />
                  </FormField>
                  {row.kind === "group" && (
                    <FormField label="Group">
                      <Select
                        selectedOption={groupOptions.find((o) => o.value === row.group_id) ?? null}
                        onChange={({ detail }) => {
                          const v = detail.selectedOption?.value;
                          updateScopeRow(index, { group_id: typeof v === "string" ? v : "" });
                        }}
                        options={groupOptions}
                        placeholder="Select group"
                        empty="Create a group first"
                      />
                    </FormField>
                  )}
                  {row.kind === "agent" && (
                    <FormField label="Agent">
                      <Select
                        selectedOption={agentOptions.find((o) => o.value === row.agent_id) ?? null}
                        onChange={({ detail }) => {
                          const v = detail.selectedOption?.value;
                          updateScopeRow(index, { agent_id: typeof v === "string" ? v : "" });
                        }}
                        options={agentOptions}
                        placeholder="Select agent"
                        filteringType="auto"
                      />
                    </FormField>
                  )}
                  <div className="sentinel-notify-scope-remove">
                    <Button
                      disabled={ruleForm.scopes.length <= 1}
                      variant="icon"
                      iconName="remove"
                      ariaLabel="Remove scope"
                      onClick={() => removeScopeRow(index)}
                    />
                  </div>
                </SpaceBetween>
              </SpaceBetween>
            </Box>
          ))}
          <Button onClick={addScopeRow}>Add scope</Button>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={Boolean(deleteGroup)}
        onDismiss={() => setDeleteGroup(null)}
        header="Delete group?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteGroup(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirmDeleteGroup()}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Delete &quot;{deleteGroup?.name}&quot;? Alert rule scopes referencing this group will be removed (cascade).
      </Modal>

      <Modal
        visible={Boolean(deleteRule)}
        onDismiss={() => setDeleteRule(null)}
        header="Delete alert rule?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteRule(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirmDeleteRule()}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Delete rule #{deleteRule?.id}
        {deleteRule?.name ? ` (${deleteRule.name})` : ""}?
      </Modal>
      </div>
    </ContentLayout>
  );
}
