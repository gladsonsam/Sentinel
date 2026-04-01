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
import { api } from "../lib/api";
import type { ThemeMode } from "../hooks/useTheme";
import { saveServerSettings, type ServerSettings, getServerSettings } from "../lib/serverSettings";

interface SettingsPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onBack?: () => void;
}

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

export function SettingsPage({ themeMode, onThemeChange, onBack }: SettingsPageProps) {
  const [settings] = useState<ServerSettings>(getServerSettings);
  const [retention, setRetention] = useState({ keylog_days: 30, window_days: 30, url_days: 30 });
  const [storage, setStorage] = useState<{ database_bytes: number; tables: { name: string; bytes: number }[] } | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMeta = async () => {
    try {
      setLoadingMeta(true);
      const [r, s] = await Promise.all([api.retentionGlobalGet(), api.storageUsage()]);
      setRetention({
        keylog_days: r.keylog_days ?? 30,
        window_days: r.window_days ?? 30,
        url_days: r.url_days ?? 30,
      });
      setStorage(s);
    } finally {
      setLoadingMeta(false);
    }
  };

  useEffect(() => {
    loadMeta();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      saveServerSettings(settings);
      await api.retentionGlobalPut({
        keylog_days: retention.keylog_days,
        window_days: retention.window_days,
        url_days: retention.url_days,
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
                selectedOption={{ label: themeMode, value: themeMode }}
                onChange={({ detail }) => {
                  const val = detail.selectedOption.value as ThemeMode | undefined;
                  if (val) onThemeChange(val);
                }}
                options={[
                  { label: "System", value: "system" },
                  { label: "Light", value: "light" },
                  { label: "Dark", value: "dark" },
                ]}
              />
            </FormField>

            {/* (reserved) */}
          </SpaceBetween>
        </Container>

        <Container header="Data retention">
          <SpaceBetween size="s">
            <FormField label="Keystrokes retention (days)">
              <Input
                type="number"
                value={String(retention.keylog_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    keylog_days: Number(detail.value || "30"),
                  }))
                }
              />
            </FormField>
            <FormField label="Windows/activity retention (days)">
              <Input
                type="number"
                value={String(retention.window_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    window_days: Number(detail.value || "30"),
                  }))
                }
              />
            </FormField>
            <FormField label="URLs retention (days)">
              <Input
                type="number"
                value={String(retention.url_days)}
                onChange={({ detail }) =>
                  setRetention((prev) => ({
                    ...prev,
                    url_days: Number(detail.value || "30"),
                  }))
                }
              />
            </FormField>
            <Box fontSize="body-s" color="text-body-secondary">
              Raw telemetry older than this is pruned. Top URL/window aggregates remain available.
            </Box>
          </SpaceBetween>
        </Container>

        <Container
          header="Storage usage"
          footer={
            <Button iconName="refresh" onClick={loadMeta} loading={loadingMeta}>
              Refresh usage
            </Button>
          }
        >
          {storage ? (
            <SpaceBetween size="m">
              <ColumnLayout columns={2}>
                <Box>
                  <Box variant="awsui-key-label">Database total</Box>
                  <div>{formatBytesAdaptive(storage.database_bytes)}</div>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">Tracked tables</Box>
                  <div>{storage.tables.length}</div>
                </Box>
              </ColumnLayout>
              <Table
                items={storage.tables}
                columnDefinitions={[
                  { id: "name", header: "Table", cell: (item) => item.name },
                  { id: "bytes", header: "Size", cell: (item) => formatBytesAdaptive(item.bytes) },
                ]}
                variant="embedded"
              />
            </SpaceBetween>
          ) : (
            <Box color="text-body-secondary">No storage data yet.</Box>
          )}
        </Container>

      </SpaceBetween>
    </ContentLayout>
  );
}
