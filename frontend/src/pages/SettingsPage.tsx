import { useEffect, useState } from "react";
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
import { api } from "../lib/api";
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

  const isAdmin = currentUser?.role === "admin";

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
            <Header variant="h2" description="Total size is PostgreSQL pg_database_size (entire DB on disk). The table lists every heap, partitioned parent, and materialized view in the public schema with indexes and TOAST included per relation.">
              Storage usage
            </Header>
          }
          footer={
            <Button iconName="refresh" onClick={loadMeta} loading={loadingMeta}>
              Refresh usage
            </Button>
          }
        >
          {storage ? (
            <SpaceBetween size="m">
              <ColumnLayout columns={3} variant="text-grid">
                <Box>
                  <Box variant="awsui-key-label">Total database size</Box>
                  <div>{formatBytesAdaptive(storage.database_bytes)}</div>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">Public schema (sum of below)</Box>
                  <div>{formatBytesAdaptive(storage.public_tables_bytes)}</div>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">System catalogs &amp; internal</Box>
                  <div>{formatBytesAdaptive(storage.other_bytes)}</div>
                </Box>
              </ColumnLayout>
              <Box fontSize="body-s" color="text-body-secondary">
                {storage.tables.length} relation{storage.tables.length === 1 ? "" : "s"} in <Box variant="code">public</Box>{" "}
                (partition children are rolled into their parent&apos;s size).
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
