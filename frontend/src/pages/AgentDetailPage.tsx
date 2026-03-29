import { useState, useEffect, useRef, useCallback } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import { type TabKey } from "../components/navigation/SideNav";
import { SpecsTab } from "../components/tabs/SpecsTab";
import { ScreenTab } from "../components/tabs/ScreenTab";
import { KeysTab } from "../components/tabs/KeysTab";
import { WindowsTab } from "../components/tabs/WindowsTab";
import { UrlsTab } from "../components/tabs/UrlsTab";
import { FilesTab } from "../components/tabs/FilesTab";
import { AuditTab } from "../components/tabs/AuditTab";
import { ActivityTimeline } from "../components/timeline/ActivityTimeline";
import { aggregateSessions } from "../lib/session-aggregator";
import { api, apiUrl } from "../lib/api";
import type { Agent, AgentInfo } from "../lib/types";
import { PageHeader, type AgentAction } from "../components/detail/PageHeader";
import { GeneralConfig } from "../components/detail/GeneralConfig";
import { parseTimestamp } from "../lib/utils";
import { AgentSettingsTab } from "../components/AgentSettingsTab";

interface AgentDetailPageProps {
  agent: Agent;
  agentInfo: AgentInfo | null;
  sendWsMessage: (msg: any) => void;
  onNotifyInfo: (header: string, content?: string) => void;
  onNotifyWarning: (header: string, content?: string) => void;
  onNotifyError: (header: string, content?: string) => void;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBackToOverview?: () => void;
  onOpenHelp: () => void;
}

export function AgentDetailPage({
  agent,
  agentInfo,
  sendWsMessage,
  onNotifyInfo,
  onNotifyWarning,
  onNotifyError,
  activeTab,
  onTabChange,
  onBackToOverview,
  onOpenHelp,
}: AgentDetailPageProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedInfo, setResolvedInfo] = useState<AgentInfo | null>(agentInfo ?? null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (agentInfo) {
      setResolvedInfo(agentInfo);
      return;
    }
    let cancelled = false;
    const loadInfo = async () => {
      try {
        const response = await fetch(apiUrl(`/agents/${agent.id}/info`), {
          credentials: "include",
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const next = (data?.info ?? data ?? null) as AgentInfo | null;
        if (!cancelled) setResolvedInfo(next);
      } catch {
        // Keep stale value if fetch fails.
      }
    };
    loadInfo();
    return () => {
      cancelled = true;
    };
  }, [agent.id, agentInfo]);

  const loadActivityData = useCallback(async () => {
    try {
      setLoading(true);
      
      const [windowsRes, urlsRes, keysRes] = await Promise.allSettled([
        fetch(apiUrl(`/agents/${agent.id}/windows?limit=500`), { credentials: "include" }),
        fetch(apiUrl(`/agents/${agent.id}/urls?limit=500`), { credentials: "include" }),
        fetch(apiUrl(`/agents/${agent.id}/keys?limit=500`), { credentials: "include" }),
      ]);

      const windows = windowsRes.status === "fulfilled" && windowsRes.value.ok
        ? await windowsRes.value.json()
        : [];
      const urls = urlsRes.status === "fulfilled" && urlsRes.value.ok
        ? await urlsRes.value.json()
        : [];
      const keystrokes = keysRes.status === "fulfilled" && keysRes.value.ok
        ? await keysRes.value.json()
        : [];

      const windowRows = (Array.isArray(windows?.rows) ? windows.rows : Array.isArray(windows) ? windows : [])
        .map((row: any) => ({
          id: row.id ?? row.hwnd ?? 0,
          window_title: row.window_title ?? row.title ?? "Unknown window",
          exe_name: row.exe_name ?? row.app ?? "Unknown app",
          timestamp: row.timestamp ?? row.ts ?? row.created ?? "",
        }))
        .filter((row: any) => parseTimestamp(row.timestamp));

      const urlRows = (Array.isArray(urls?.rows) ? urls.rows : Array.isArray(urls) ? urls : [])
        .map((row: any) => ({
          id: row.id ?? 0,
          url: row.url ?? "",
          browser: row.browser ?? "Unknown",
          timestamp: row.timestamp ?? row.ts ?? "",
        }))
        .filter((row: any) => parseTimestamp(row.timestamp));

      const keyRows = (Array.isArray(keystrokes?.rows) ? keystrokes.rows : Array.isArray(keystrokes) ? keystrokes : [])
        .map((row: any) => ({
          id: row.id ?? 0,
          window_title: row.window_title ?? row.title ?? "",
          exe_name: row.exe_name ?? row.app ?? "",
          keys: row.keys ?? row.text ?? "",
          timestamp: row.timestamp ?? row.updated_at ?? row.started_at ?? "",
        }))
        .filter((row: any) => parseTimestamp(row.timestamp));

      const aggregated = aggregateSessions({
        windows: windowRows,
        urls: urlRows,
        keystrokes: keyRows,
      });
      setSessions(aggregated);
    } catch (err) {
      console.error("Failed to load activity data:", err);
    } finally {
      setLoading(false);
    }
  }, [agent.id]);
  useEffect(() => {
    if (activeTab === "activity") {
      loadActivityData();
    }
  }, [activeTab, agent.id]);

  useEffect(() => {
    if (activeTab !== "activity") return;
    const onWsEvent = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (!detail || detail.agent_id !== agent.id) return;
      if (!["window_focus", "url", "keys", "afk", "active"].includes(detail.event)) return;
      if (activeTabRef.current !== "activity") return;

      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }
      refreshDebounceRef.current = setTimeout(() => {
        loadActivityData();
      }, 500);
    };

    window.addEventListener("sentinel-ws-event", onWsEvent as EventListener);
    return () => {
      window.removeEventListener("sentinel-ws-event", onWsEvent as EventListener);
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
    };
  }, [activeTab, agent.id, loadActivityData]);

  const runAgentAction = useCallback(
    (action: AgentAction) => {
      if (!agent.online) {
        onNotifyWarning("Agent offline", `Cannot run "${action}" while ${agent.name} is offline.`);
        return;
      }

      if (action === "wake-lan") {
        void api
          .wakeAgent(agent.id)
          .then((r) =>
            onNotifyInfo(
              "Wake on LAN sent",
              `Magic packet sent to ${r.mac} (${r.broadcast}:${r.port}). WoL must be enabled on the PC; the server must reach the subnet broadcast.`,
            ),
          )
          .catch((e) => onNotifyError("Wake on LAN failed", String(e)));
        return;
      }

      if (action === "request-info") {
        sendWsMessage({
          type: "control",
          agent_id: agent.id,
          cmd: { type: "RequestInfo" },
        });
        onNotifyInfo("Requested system info", `Asked ${agent.name} to send fresh specs.`);
        return;
      }

      if (action === "restart-host") {
        sendWsMessage({
          type: "control",
          agent_id: agent.id,
          cmd: { type: "RestartHost" },
        });
        onNotifyWarning("Restart sent", `Sent restart command to ${agent.name}.`);
        return;
      }

      if (action === "shutdown-host") {
        sendWsMessage({
          type: "control",
          agent_id: agent.id,
          cmd: { type: "ShutdownHost" },
        });
        onNotifyWarning("Shutdown sent", `Sent shutdown command to ${agent.name}.`);
        return;
      }

      onNotifyError("Unsupported action", `Action "${action}" is not implemented.`);
    },
    [agent.id, agent.name, agent.online, sendWsMessage, onNotifyInfo, onNotifyWarning, onNotifyError]
  );

  const renderTabContent = (tab: TabKey) => {
    switch (tab) {
      case "activity":
        return (
          <ActivityTimeline
            sessions={sessions}
            loading={loading}
            onRefresh={loadActivityData}
          />
        );
      case "specs":
        return <SpecsTab agentId={agent.id} cachedInfo={resolvedInfo} />;
      case "screen":
        return <ScreenTab agentId={agent.id} sendWsMessage={sendWsMessage} />;
      case "keys":
        return <KeysTab agentId={agent.id} />;
      case "windows":
        return <WindowsTab agentId={agent.id} />;
      case "urls":
        return <UrlsTab agentId={agent.id} />;
      case "files":
        return <FilesTab agentId={agent.id} sendWsMessage={sendWsMessage} />;
      case "audit":
        return <AuditTab agentId={agent.id} />;
      case "settings":
        return <AgentSettingsTab agentId={agent.id} agentName={agent.name} />;
      default:
        return null;
    }
  };

  const tabs = [
    { id: "activity", label: "Activity", content: activeTab === "activity" ? renderTabContent("activity") : null },
    { id: "specs", label: "Specs", content: activeTab === "specs" ? renderTabContent("specs") : null },
    { id: "screen", label: "Screen", content: activeTab === "screen" ? renderTabContent("screen") : null },
    { id: "keys", label: "Keys", content: activeTab === "keys" ? renderTabContent("keys") : null },
    { id: "windows", label: "Windows", content: activeTab === "windows" ? renderTabContent("windows") : null },
    { id: "urls", label: "URLs", content: activeTab === "urls" ? renderTabContent("urls") : null },
    { id: "files", label: "Files", content: activeTab === "files" ? renderTabContent("files") : null },
    { id: "audit", label: "Audit", content: activeTab === "audit" ? renderTabContent("audit") : null },
    { id: "settings", label: "Settings", content: activeTab === "settings" ? renderTabContent("settings") : null },
  ];
  const breadcrumbTabLabel = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);

  return (
    <ContentLayout>
      <SpaceBetween size="l">
        <BreadcrumbGroup
          items={[
            { text: "Agents", href: "#overview" },
            { text: agent.name, href: `#agent/${agent.id}` },
            { text: breadcrumbTabLabel, href: `#${activeTab}` },
          ]}
          onFollow={(event) => {
            event.preventDefault();
            const href = event.detail.href;
            if (href === "#overview" && onBackToOverview) {
              onBackToOverview();
            }
          }}
        />

        <PageHeader
          agent={agent}
          onBackToOverview={onBackToOverview}
          onOpenHelp={onOpenHelp}
          onRunAction={runAgentAction}
        />

        <GeneralConfig agent={agent} info={resolvedInfo} onOpenHelp={onOpenHelp} />

        <Tabs
          activeTabId={activeTab}
          tabs={tabs}
          onChange={({ detail }) => onTabChange(detail.activeTabId as TabKey)}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
