import { useEffect, useMemo, useState } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Toggle from "@cloudscape-design/components/toggle";
import Alert from "@cloudscape-design/components/alert";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { api } from "../lib/api";
import { formatEnrollmentOtp6 } from "../lib/formatEnrollmentCode";
import type { ThemeMode } from "../hooks/useTheme";
import { saveServerSettings, type ServerSettings, getServerSettings } from "../lib/serverSettings";
import type { DashboardNavUser, StorageUsage } from "../lib/types";

interface SettingsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onBack?: () => void;
  currentUser?: DashboardNavUser | null;
}

const THEME_SELECT_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

function formatBytesAdaptive(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

export function SettingsPage({
  themeMode,
  onThemeChange,
  onBack,
  currentUser = null,
}: SettingsPageProps) {
  const [settings] = useState<ServerSettings>(getServerSettings);
  const [retention, setRetention] = useState({ keylog_days: 0, window_days: 0, url_days: 0 });
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [githubRelease, setGithubRelease] = useState<{
    tag: string | null;
    releasesUrl: string;
  } | null>(null);
  const [githubReleaseLoading, setGithubReleaseLoading] = useState(false);
  const [githubReleaseError, setGithubReleaseError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [agentAutoUpdateEnabled, setAgentAutoUpdateEnabled] = useState<boolean | null>(null);
  const [agentAutoUpdateLoadErr, setAgentAutoUpdateLoadErr] = useState<string | null>(null);
  const [agentAutoUpdateSaveErr, setAgentAutoUpdateSaveErr] = useState<string | null>(null);
  const [agentAutoUpdateSaving, setAgentAutoUpdateSaving] = useState(false);

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

  const [enrollTokens, setEnrollTokens] = useState<
    {
      id: string;
      uses_remaining: number;
      created_at: string;
      expires_at: string | null;
      note: string | null;
      used_count: number;
      last_used_at: string | null;
    }[]
  >([]);
  const [enrollTokensLoading, setEnrollTokensLoading] = useState(false);
  const [enrollTokensError, setEnrollTokensError] = useState<string | null>(null);
  const [tokenUses, setTokenUses] = useState<Record<string, { loading: boolean; error: string | null; rows: { used_at: string; agent_name: string; agent_id: string | null }[] }>>(
    {},
  );

  // (removed) agent credential reset-by-id: prefer deleting agents from the overview.

  const isAdmin = currentUser?.role === "admin";

  const loadEnrollmentTokens = async () => {
    if (!isAdmin) return;
    setEnrollTokensLoading(true);
    setEnrollTokensError(null);
    try {
      const r = await api.listAgentEnrollmentTokens();
      setEnrollTokens(r.tokens ?? []);
    } catch (e: unknown) {
      setEnrollTokensError(String((e as { message?: string })?.message ?? e));
      setEnrollTokens([]);
    } finally {
      setEnrollTokensLoading(false);
    }
  };

  const loadGithubRelease = async (nocache: boolean) => {
    setGithubReleaseLoading(true);
    setGithubReleaseError(null);
    try {
      const v = await api.settingsVersionGet({ nocache });
      setGithubRelease({
        tag: v.latest_server_release,
        releasesUrl: v.releases_url,
      });
    } catch (e: unknown) {
      setGithubReleaseError(String((e as { message?: string })?.message || "Failed to load GitHub release"));
      if (!nocache) setGithubRelease(null);
    } finally {
      setGithubReleaseLoading(false);
    }
  };

  const loadMeta = async () => {
    setLoadingMeta(true);
    try {
      const [r, s] = await Promise.all([api.retentionGlobalGet(), api.storageUsage()]);
      setRetention({
        keylog_days: r.keylog_days ?? 0,
        window_days: r.window_days ?? 0,
        url_days: r.url_days ?? 0,
      });
      setStorage(s);
    } catch {
      /* retention/storage optional for About; agent policy loads below */
    }
    try {
      const au = await api.agentAutoUpdateGlobalGet();
      setAgentAutoUpdateEnabled(au.enabled);
      setAgentAutoUpdateLoadErr(null);
    } catch {
      setAgentAutoUpdateEnabled(null);
      setAgentAutoUpdateLoadErr("Could not load the global agent auto-update policy.");
    } finally {
      setLoadingMeta(false);
    }
    await loadEnrollmentTokens();
  };

  const saveGlobalAutoUpdate = async (enabled: boolean) => {
    if (!isAdmin) return;
    setAgentAutoUpdateSaving(true);
    setAgentAutoUpdateSaveErr(null);
    try {
      const res = await api.agentAutoUpdateGlobalPut({ enabled });
      setAgentAutoUpdateEnabled(res.enabled);
    } catch (e) {
      setAgentAutoUpdateSaveErr(String(e));
    } finally {
      setAgentAutoUpdateSaving(false);
    }
  };

  useEffect(() => {
    void loadMeta();
    void loadGithubRelease(false);
  }, []);

  const generateEnrollmentToken = async () => {
    if (!isAdmin) return;
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
      await loadEnrollmentTokens();
    } catch (e: unknown) {
      setEnrollError(String((e as { message?: string })?.message ?? e));
      setEnrollResult(null);
    } finally {
      setEnrollLoading(false);
    }
  };

  const copyEnrollmentToken = async () => {
    if (!enrollResult?.token) return;
    try {
      await navigator.clipboard.writeText(enrollResult.token);
    } catch {
      /* ignore */
    }
  };

  const tokenColumns = useMemo(
    () => [
      {
        id: "created_at",
        header: "Created",
        cell: (t: (typeof enrollTokens)[number]) => new Date(t.created_at).toLocaleString(),
      },
      {
        id: "expires_at",
        header: "Expires",
        cell: (t: (typeof enrollTokens)[number]) =>
          t.expires_at ? new Date(t.expires_at).toLocaleString() : "—",
      },
      {
        id: "uses_remaining",
        header: "Uses left",
        cell: (t: (typeof enrollTokens)[number]) => String(t.uses_remaining ?? 0),
      },
      {
        id: "used_count",
        header: "Used",
        cell: (t: (typeof enrollTokens)[number]) => String(t.used_count ?? 0),
      },
      {
        id: "last_used_at",
        header: "Last used",
        cell: (t: (typeof enrollTokens)[number]) =>
          t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "—",
      },
      {
        id: "note",
        header: "Note",
        cell: (t: (typeof enrollTokens)[number]) => (t.note?.trim() ? t.note : "—"),
      },
      {
        id: "actions",
        header: "",
        cell: (t: (typeof enrollTokens)[number]) => (
          <SpaceBetween direction="horizontal" size="xs">
            {(t.used_count ?? 0) > 0 ? (
              <Button
                onClick={() => {
                  const cur = tokenUses[t.id];
                  if (cur?.rows?.length || cur?.loading) return;
                  setTokenUses((prev) => ({ ...prev, [t.id]: { loading: true, error: null, rows: [] } }));
                  void api
                    .listAgentEnrollmentTokenUses(t.id)
                    .then((r) => {
                      setTokenUses((prev) => ({
                        ...prev,
                        [t.id]: { loading: false, error: null, rows: r.uses ?? [] },
                      }));
                    })
                    .catch((e: unknown) => {
                      setTokenUses((prev) => ({
                        ...prev,
                        [t.id]: {
                          loading: false,
                          error: String((e as { message?: string })?.message ?? e),
                          rows: [],
                        },
                      }));
                    });
                }}
              >
                View uses
              </Button>
            ) : null}
            {(t.uses_remaining ?? 0) > 0 ? (
              <Button
                onClick={() => {
                  if (!confirm("Revoke this enrollment code? It will become unusable.")) return;
                  void api
                    .revokeAgentEnrollmentToken(t.id)
                    .then(() => loadEnrollmentTokens())
                    .catch((e: unknown) => setEnrollTokensError(String((e as { message?: string })?.message ?? e)));
                }}
              >
                Revoke
              </Button>
            ) : null}
          </SpaceBetween>
        ),
      },
    ],
    [enrollTokens, tokenUses],
  );

  const save = async () => {
    setSaving(true);
    try {
      saveServerSettings(settings);
      await api.retentionGlobalPut({
        keylog_days: retention.keylog_days === 0 ? null : retention.keylog_days,
        window_days: retention.window_days === 0 ? null : retention.window_days,
        url_days: retention.url_days === 0 ? null : retention.url_days,
      });
      await loadMeta();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ContentLayout>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Configure server connection, telemetry retention, and storage. Open Activity log from the top bar for the central audit trail."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {onBack && (
                <Button iconName="angle-left" onClick={onBack}>
                  Back
                </Button>
              )}
              <Button variant="primary" onClick={save} loading={saving}>
                Save settings
              </Button>
            </SpaceBetween>
          }
        >
          Settings
        </Header>

        <Container header="Appearance & connection">
          <SpaceBetween size="l">
            <FormField
              label="Theme"
              description="Applied immediately and persisted in browser storage."
            >
              <Select
                selectedOption={
                  THEME_SELECT_OPTIONS.find((o) => o.value === themeMode) ??
                  THEME_SELECT_OPTIONS[0]
                }
                onChange={({ detail }) => {
                  const val = detail.selectedOption.value as ThemeMode | undefined;
                  if (val) onThemeChange(val);
                }}
                options={THEME_SELECT_OPTIONS}
              />
            </FormField>

            {/* (reserved) */}
          </SpaceBetween>
        </Container>

        {isAdmin ? (
          <Container
            header={
              <Header variant="h2" description="Creates a 6-digit code for Windows agent adoption (no shared server secret). On the Agents overview, Add agent shows live LAN hints. Prefer a short expiry for small codes. LAN mDNS defaults on when PUBLIC_BASE_URL or SENTINEL_MDNS_WSS_URL is set; SENTINEL_MDNS=0 turns it off.">
                Agent enrollment codes
              </Header>
            }
          >
            <SpaceBetween size="m">
              <Box fontSize="body-s" color="text-body-secondary">
                On the PC, open agent settings (Ctrl+Shift+F12), enter the WebSocket URL and the six digits, then{" "}
                <Box variant="strong" display="inline">
                  Connect with code
                </Box>
                . Single-use and a short expiry are safest on untrusted networks.
              </Box>
              <ColumnLayout columns={3} variant="text-grid">
                <FormField label="Uses" description="How many successful adoptions share this code.">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={String(enrollUses)}
                    onChange={({ detail }) =>
                      setEnrollUses(Math.max(1, Math.min(100_000, Number(detail.value) || 1)))
                    }
                  />
                </FormField>
                <FormField
                  label="Expires in (hours)"
                  description="Leave empty for no expiry."
                >
                  <Input
                    value={enrollExpireHours}
                    onChange={({ detail }) => setEnrollExpireHours(detail.value)}
                    placeholder="e.g. 72"
                  />
                </FormField>
                <FormField label="Note (optional)" description="Shown only in the API response.">
                  <Input value={enrollNote} onChange={({ detail }) => setEnrollNote(detail.value)} />
                </FormField>
              </ColumnLayout>
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={() => void generateEnrollmentToken()} loading={enrollLoading}>
                  Generate code
                </Button>
                {enrollResult ? (
                  <Button onClick={() => void copyEnrollmentToken()}>Copy code</Button>
                ) : null}
              </SpaceBetween>
              {enrollError ? (
                <Alert type="error" dismissible onDismiss={() => setEnrollError(null)}>
                  {enrollError}
                </Alert>
              ) : null}
              {enrollResult ? (
                <SpaceBetween size="s">
                  <Alert type="success" header="Enrollment code (6 digits)">
                    <Box variant="code" fontSize="display-l" margin={{ top: "xs" }} fontWeight="bold">
                      {formatEnrollmentOtp6(enrollResult.token)}
                    </Box>
                    <Box fontSize="body-s" margin={{ top: "s" }} color="text-body-secondary">
                      Uses remaining after creation: {enrollResult.uses}
                      {enrollResult.expires_at
                        ? ` · Expires: ${new Date(enrollResult.expires_at).toLocaleString()}`
                        : ""}
                    </Box>
                  </Alert>
                </SpaceBetween>
              ) : null}

              <Container
                header={
                  <Header
                    variant="h3"
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button
                          onClick={() => {
                            if (!confirm("Revoke all enrollment codes? Any unused codes will become unusable.")) return;
                            setEnrollTokensLoading(true);
                            setEnrollTokensError(null);
                            void api
                              .revokeAllAgentEnrollmentTokens()
                              .then(() => loadEnrollmentTokens())
                              .catch((e: unknown) =>
                                setEnrollTokensError(String((e as { message?: string })?.message ?? e)),
                              )
                              .finally(() => setEnrollTokensLoading(false));
                          }}
                          disabled={enrollTokensLoading || enrollTokens.every((t) => (t.uses_remaining ?? 0) <= 0)}
                        >
                          Revoke all
                        </Button>
                        <Button onClick={() => void loadEnrollmentTokens()} loading={enrollTokensLoading}>
                          Refresh
                        </Button>
                      </SpaceBetween>
                    }
                  >
                    Keys
                  </Header>
                }
              >
                <SpaceBetween size="s">
                  {enrollTokensError ? (
                    <Alert type="error" dismissible onDismiss={() => setEnrollTokensError(null)}>
                      {enrollTokensError}
                    </Alert>
                  ) : null}
                  <Table
                    items={enrollTokens}
                    columnDefinitions={tokenColumns}
                    variant="embedded"
                    loading={enrollTokensLoading}
                    loadingText="Loading keys…"
                    empty={<Box color="text-body-secondary">No enrollment keys yet.</Box>}
                  />
                  {Object.entries(tokenUses)
                    .filter(([, v]) => v.rows.length > 0 || v.loading || v.error)
                    .map(([tokenId, v]) => (
                      <Container key={tokenId} header={<Header variant="h3">Uses for {tokenId}</Header>}>
                        {v.error ? (
                          <Alert type="error" dismissible onDismiss={() => setTokenUses((p) => ({ ...p, [tokenId]: { ...v, error: null } }))}>
                            {v.error}
                          </Alert>
                        ) : null}
                        {v.loading ? (
                          <Box color="text-body-secondary" fontSize="body-s">
                            Loading…
                          </Box>
                        ) : (
                          <Table
                            items={v.rows}
                            columnDefinitions={[
                              {
                                id: "used_at",
                                header: "Used at",
                                cell: (r: (typeof v.rows)[number]) => new Date(r.used_at).toLocaleString(),
                              },
                              {
                                id: "agent_name",
                                header: "Agent name",
                                cell: (r: (typeof v.rows)[number]) => r.agent_name,
                              },
                              {
                                id: "agent_id",
                                header: "Agent id",
                                cell: (r: (typeof v.rows)[number]) => r.agent_id ?? "—",
                              },
                            ]}
                            variant="embedded"
                            empty={<Box color="text-body-secondary">No uses recorded yet.</Box>}
                          />
                        )}
                      </Container>
                    ))}
                </SpaceBetween>
              </Container>

              
            </SpaceBetween>
          </Container>
        ) : null}

        <Container header="Data retention">
          <SpaceBetween size="s">
            <Box fontSize="body-s" color="text-body-secondary">
              Set to <Box variant="code">0</Box> for unlimited retention (no automatic prune) for that category. Values 1–36500
              delete raw rows older than that many days. Top URL/window aggregates are kept separately.
            </Box>
            <FormField label="Keystrokes retention (days)" description="0 = keep all keystroke sessions.">
              <Input
                type="number"
                inputMode="numeric"
                value={String(retention.keylog_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    keylog_days: Math.max(0, Math.min(36500, Number(detail.value) || 0)),
                  }))
                }
              />
            </FormField>
            <FormField label="Windows/activity retention (days)" description="0 = keep all window and AFK/active events.">
              <Input
                type="number"
                inputMode="numeric"
                value={String(retention.window_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    window_days: Math.max(0, Math.min(36500, Number(detail.value) || 0)),
                  }))
                }
              />
            </FormField>
            <FormField label="URLs retention (days)" description="0 = keep all URL visit rows.">
              <Input
                type="number"
                inputMode="numeric"
                value={String(retention.url_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    url_days: Math.max(0, Math.min(36500, Number(detail.value) || 0)),
                  }))
                }
              />
            </FormField>
          </SpaceBetween>
        </Container>

        <Container
          header={
            <Header
              variant="h2"
              description="Total size is PostgreSQL pg_database_size (entire DB on disk). Expand to see per-table breakdown."
              actions={
                <Button iconName="refresh" onClick={loadMeta} loading={loadingMeta}>
                  Refresh usage
                </Button>
              }
            >
              Storage usage
            </Header>
          }
        >
          <SpaceBetween size="m">
            <ColumnLayout columns={3} variant="text-grid">
              <Box>
                <Box variant="awsui-key-label">Total database size</Box>
                <div>{storage ? formatBytesAdaptive(storage.database_bytes) : "—"}</div>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Public schema</Box>
                <div>{storage ? formatBytesAdaptive(storage.public_tables_bytes) : "—"}</div>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Other</Box>
                <div>{storage ? formatBytesAdaptive(storage.other_bytes) : "—"}</div>
              </Box>
            </ColumnLayout>

            <ExpandableSection headerText="Details" defaultExpanded={false}>
              {storage ? (
                <SpaceBetween size="m">
                  <Box fontSize="body-s" color="text-body-secondary">
                    {storage.tables.length} relation{storage.tables.length === 1 ? "" : "s"} in{" "}
                    <Box variant="code">public</Box> (partition children are rolled into their parent&apos;s size).
                  </Box>
                  <Table
                    items={storage.tables}
                    columnDefinitions={[
                      { id: "name", header: "Relation", cell: (item) => item.name },
                      { id: "bytes", header: "Size (with indexes)", cell: (item) => formatBytesAdaptive(item.bytes) },
                    ]}
                    variant="embedded"
                  />
                </SpaceBetween>
              ) : (
                <Box color="text-body-secondary">No storage data yet.</Box>
              )}
            </ExpandableSection>
          </SpaceBetween>
        </Container>

        <Container
          header={
            <Header variant="h2" description="Tag from the latest GitHub release (same source as server Docker images).">
              About
            </Header>
          }
          footer={
            <Button
              iconName="refresh"
              loading={githubReleaseLoading}
              onClick={() => void loadGithubRelease(true)}
            >
              Check GitHub now
            </Button>
          }
        >
          <SpaceBetween size="m">
            {githubReleaseError ? (
              <Box color="text-status-error">{githubReleaseError}</Box>
            ) : null}
            {agentAutoUpdateSaveErr ? (
              <Alert type="error" dismissible onDismiss={() => setAgentAutoUpdateSaveErr(null)}>
                {agentAutoUpdateSaveErr}
              </Alert>
            ) : null}
            {agentAutoUpdateLoadErr ? (
              <Alert type="error">{agentAutoUpdateLoadErr}</Alert>
            ) : agentAutoUpdateEnabled === null && loadingMeta ? (
              <Box color="text-body-secondary">Loading agent auto-update policy…</Box>
            ) : (
              <FormField
                label="Agent auto updates (global default)"
                description={
                  isAdmin
                    ? "When enabled, the server tells connected Windows agents they may check GitHub releases and install updates (policy is pushed over the WebSocket). Operators can still set a per-computer override on each agent’s Settings tab."
                    : "Current default policy for Windows agents. Only administrators can change it."
                }
                constraintText={!isAdmin ? "Administrator role required to edit." : undefined}
              >
                <Toggle
                  checked={agentAutoUpdateEnabled ?? false}
                  disabled={
                    agentAutoUpdateEnabled === null || !isAdmin || agentAutoUpdateSaving || loadingMeta
                  }
                  onChange={({ detail }) => void saveGlobalAutoUpdate(detail.checked)}
                >
                  Enable agent auto updates by default
                </Toggle>
              </FormField>
            )}
            <Box>
              <Box variant="awsui-key-label">Latest GitHub release</Box>
              <div>{githubReleaseLoading && githubRelease == null ? "…" : githubRelease?.tag ?? "—"}</div>
              {githubRelease?.releasesUrl ? (
                <Box fontSize="body-s" margin={{ top: "xs" }} color="text-body-secondary">
                  <a href={githubRelease.releasesUrl} target="_blank" rel="noopener noreferrer">
                    Open releases on GitHub
                  </a>
                </Box>
              ) : null}
            </Box>
          </SpaceBetween>
        </Container>

      </SpaceBetween>
    </ContentLayout>
  );
}
