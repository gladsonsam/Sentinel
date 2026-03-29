import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import type { ThemeMode } from "../../hooks/useTheme";
import {
  getServerSettings,
  saveServerSettings,
  type ServerSettings,
} from "../../lib/serverSettings";

interface ServerSettingsModalProps {
  visible: boolean;
  onDismiss: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function ServerSettingsModal({
  visible,
  onDismiss,
  themeMode,
  onThemeChange,
}: ServerSettingsModalProps) {
  const [settings, setSettings] = useState<ServerSettings>(getServerSettings);

  const save = () => {
    saveServerSettings(settings);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Server settings"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
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

        <FormField
          label="Server origin"
          description="Optional. Example: https://sentinel.example.com"
        >
          <Input
            value={settings.serverOrigin}
            onChange={({ detail }) =>
              setSettings((prev) => ({ ...prev, serverOrigin: detail.value.trim() }))
            }
            placeholder="(empty = current host)"
          />
        </FormField>

        <FormField label="API prefix">
          <Input
            value={settings.apiPrefix}
            onChange={({ detail }) =>
              setSettings((prev) => ({ ...prev, apiPrefix: detail.value || "/api" }))
            }
            placeholder="/api"
          />
        </FormField>

        <FormField label="Viewer WebSocket path">
          <Input
            value={settings.wsViewerPath}
            onChange={({ detail }) =>
              setSettings((prev) => ({ ...prev, wsViewerPath: detail.value || "/ws/view" }))
            }
            placeholder="/ws/view"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

