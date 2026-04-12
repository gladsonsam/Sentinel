import { useState, useEffect, useRef, useCallback } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import {
  AGENT_DATA_SUBTABS,
  AGENT_LIVE_SUBTABS,
  AGENT_SECTION_ORDER,
  AGENT_SYSTEM_SUBTABS,
  AgentSectionTabLabel,
  agentSectionFromTabKey,
  agentTabBreadcrumbLabel,
  defaultTabForAgentSection,
  AGENT_TAB_META,
  type AgentSectionId,
} from "../lib/agentTabNav";
import type { TabKey, DashboardRole, WsEvent } from "../lib/types";
import { SpecsTab } from "../components/tabs/SpecsTab";
import { ScreenTab } from "../components/tabs/ScreenTab";
import { KeysTab } from "../components/tabs/KeysTab";
import { WindowsTab } from "../components/tabs/WindowsTab";
import { UrlsTab } from "../components/tabs/UrlsTab";
import { AlertsTab } from "../components/tabs/AlertsTab";
import { FilesTab } from "../components/tabs/FilesTab";
import { AuditTab } from "../components/tabs/AuditTab";
import { SoftwareTab } from "../components/tabs/SoftwareTab";
import { ScriptsTab } from "../components/tabs/ScriptsTab";
import {
  aggregateSessions,
  attachAlertEventsToSessions,
  type Session,
  type SessionAlertEvent,
} from "../lib/session-aggregator";
import { api, apiUrl } from "../lib/api";
import type { Agent, AgentInfo, AgentLiveStatus } from "../lib/types";
import { PageHeader, type AgentAction } from "../components/detail/PageHeader";
import { GeneralConfig } from "../components/detail/GeneralConfig";
import { parseTimestamp } from "../lib/utils";
import { AgentSettingsTab } from "../components/AgentSettingsTab";
import { ActivityTimeline } from "../components/timeline/ActivityTimeline";

interface AgentDetailPageProps {
  agent: Agent;
  agentInfo: AgentInfo | null;
  liveStatus?: AgentLiveStatus;
  sendWsMessage: (msg: unknown) => void;
  onNotifyInfo: (header: string, content?: string) => void;
  onNotifyWarning: (header: string, content?: string) => void;
  onNotifyError: (header: string, content?: string) => void;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBackToOverview?: () => void;
  onOpenHelp: () => void;
  /** ISO timestamp to scroll to + highlight in the activity timeline */
  highlightTimestamp?: string | null;
  isAdmin?: boolean;
  onOpenAgentGroups?: () => void;
  /** Current dashboard role; used to explain screen/script permission limits. */
  dashboardRole?: DashboardRole | null;
}

export function AgentDetailPage({
  agent,
  agentInfo,
  liveStatus,
  sendWsMessage,
  onNotifyInfo,
  onNotifyWarning,
  onNotifyError,
  activeTab,
  onTabChange,
  onBackToOverview,
  highlightTimestamp,
  onOpenHelp,
  isAdmin = false,
  onOpenAgentGroups,
  dashboardRole = null,
}: AgentDetailPageProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedInfo, setResolvedInfo] = useState<AgentInfo | null>(agentInfo ?? null);
  const [inferredIdleSeconds, setInferredIdleSeconds] = useState<number | null>(null);
  /** Timestamp set when user clicks "View in Timeline" from the Alerts tab (overrides URL param) */
  const [timelineHighlight, setTimelineHighlight] = useState<string | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef(activeTab);

  // Merge prop-based highlightTimestamp (from URL ?at=) with local state
  const effectiveHighlightTimestamp = timelineHighlight ?? highlightTimestamp;

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Seed AFK/idle indicator from stored activity_log (so agent header can show it even before live WS events arrive).
  // If keys/windows/URLs exist newer than that AFK row, the user has been active since — do not infer idle from stale AFK.
  useEffect(() => {
    let cancelled = false;
    const loadLastActivity = async () => {
      try {
        const res = await fetch(apiUrl(`/agents/${agent.id}/activity?limit=1&offset=0`), {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const row = Array.isArray(data?.rows) ? data.rows[0] : Array.isArray(data) ? data[0] : null;
        const eventType = String(row?.event_type ?? row?.kind ?? "").toLowerCase();
        if (eventType !== "afk") {
          if (!cancelled) setInferredIdleSeconds(null);
          return;
        }
        const idleAtTransition = Number(row?.idle_secs ?? row?.idle_seconds ?? 0);
        const tsRaw = String(row?.ts ?? row?.timestamp ?? "");
        const afkTs = parseTimestamp(tsRaw);
        if (!afkTs) return;

        const cred = { credentials: "include" as const };
        const [keysRes, winRes, urlRes] = await Promise.all([
          fetch(apiUrl(`/agents/${agent.id}/keys?limit=1&offset=0`), cred),
          fetch(apiUrl(`/agents/${agent.id}/windows?limit=1&offset=0`), cred),
          fetch(apiUrl(`/agents/${agent.id}/urls?limit=1&offset=0`), cred),
        ]);

        const newestAfterAfk = (body: unknown, tsKeys: string[]): Date | null => {
          const arr = Array.isArray((body as { rows?: unknown })?.rows)
            ? (body as { rows: Record<string, unknown>[] }).rows
            : Array.isArray(body)
              ? (body as Record<string, unknown>[])
              : [];
          const r = arr[0];
          if (!r) return null;
          for (const k of tsKeys) {
            const d = parseTimestamp(String(r[k] ?? ""));
            if (d && d.getTime() > afkTs.getTime()) return d;
          }
          return null;
        };

        let hasNewerTelemetry = false;
        if (keysRes.ok) {
          try {
            hasNewerTelemetry ||= newestAfterAfk(await keysRes.json(), [
              "updated_at",
              "timestamp",
              "ts",
              "started_at",
            ]) != null;
          } catch {
            /* ignore */
          }
        }
        if (!hasNewerTelemetry && winRes.ok) {
          try {
            hasNewerTelemetry ||= newestAfterAfk(await winRes.json(), ["timestamp", "ts", "created"]) != null;
          } catch {
            /* ignore */
          }
        }
        if (!hasNewerTelemetry && urlRes.ok) {
          try {
            hasNewerTelemetry ||= newestAfterAfk(await urlRes.json(), ["timestamp", "ts"]) != null;
          } catch {
            /* ignore */
          }
        }

        if (hasNewerTelemetry) {
          if (!cancelled) setInferredIdleSeconds(null);
          return;
        }

        const nowMs = Date.now();
        const base = Number.isFinite(idleAtTransition) && idleAtTransition > 0 ? idleAtTransition : 0;
        const extra = Math.max(0, Math.floor((nowMs - afkTs.getTime()) / 1000));
        if (!cancelled) setInferredIdleSeconds(base + extra);
      } catch {
        // Ignore; header just won't show inferred idle.
      }
    };
    loadLastActivity();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  useEffect(() => {
    if (liveStatus?.activity === "active") {
      setInferredIdleSeconds(null);
    }
  }, [liveStatus?.activity]);

  useEffect(() => {
    const clearsInferred = new Set(["active", "keys", "window_focus", "url"]);
    const onWs = (e: Event) => {
      const d = (e as CustomEvent<{ agent_id?: string; event?: string }>).detail;
      if (!d || d.agent_id !== agent.id) return;
      const ev = String(d.event ?? "");
      if (clearsInferred.has(ev)) {
        setInferredIdleSeconds(null);
      }
    };
    window.addEventListener("sentinel-ws-event", onWs as EventListener);
    return () => window.removeEventListener("sentinel-ws-event", onWs as EventListener);
  }, [agent.id]);

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
      
      const [windowsRes, urlsRes, keysRes, alertsRes] = await Promise.allSettled([
        fetch(apiUrl(`/agents/${agent.id}/windows?limit=500`), { credentials: "include" }),
        fetch(apiUrl(`/agents/${agent.id}/urls?limit=500`), { credentials: "include" }),
        fetch(apiUrl(`/agents/${agent.id}/keys?limit=500`), { credentials: "include" }),
        fetch(apiUrl(`/agents/${agent.id}/alert-rule-events?limit=500&offset=0`), {
          credentials: "include",
        }),
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

      type ApiRow = Record<string, unknown>;
      const windowRows = (Array.isArray(windows?.rows) ? windows.rows : Array.isArray(windows) ? windows : [])
        .map((row: ApiRow) => ({
          id: Number(row.id ?? row.hwnd ?? 0),
          window_title: String(row.window_title ?? row.title ?? "Unknown window"),
          exe_name: String(row.exe_name ?? row.app ?? "Unknown app"),
          app_display: String(row.app_display ?? row.exe_name ?? row.app ?? "Unknown app"),
          timestamp: String(row.timestamp ?? row.ts ?? row.created ?? ""),
        }))
        .filter((row: { timestamp: string }) => parseTimestamp(row.timestamp));

      const urlRows = (Array.isArray(urls?.rows) ? urls.rows : Array.isArray(urls) ? urls : [])
        .map((row: ApiRow) => ({
          id: Number(row.id ?? 0),
          url: String(row.url ?? ""),
          browser: String(row.browser ?? "Unknown"),
          timestamp: String(row.timestamp ?? row.ts ?? ""),
        }))
        .filter((row: { timestamp: string }) => parseTimestamp(row.timestamp));

      const keyRows = (Array.isArray(keystrokes?.rows) ? keystrokes.rows : Array.isArray(keystrokes) ? keystrokes : [])
        .map((row: ApiRow) => ({
          id: Number(row.id ?? 0),
          window_title: String(row.window_title ?? row.title ?? ""),
          exe_name: String(row.exe_name ?? row.app ?? ""),
          app_display: String(row.app_display ?? row.exe_name ?? row.app ?? ""),
          keys: String(row.keys ?? row.text ?? ""),
          timestamp: String(row.timestamp ?? row.updated_at ?? row.started_at ?? ""),
        }))
        .filter((row: { timestamp: string }) => parseTimestamp(row.timestamp));

      let alertEvents: SessionAlertEvent[] = [];
      if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
        try {
          const alertData = await alertsRes.value.json();
          const alertRows = Array.isArray(alertData?.rows) ? alertData.rows : [];
          alertEvents = alertRows.map((row: Record<string, unknown>) => ({
            id: Number(row.id ?? 0),
            rule_name: String(row.rule_name ?? ""),
            channel: String(row.channel ?? ""),
            snippet: String(row.snippet ?? ""),
            created_at: String(row.created_at ?? ""),
            has_screenshot: Boolean(row.has_screenshot),
            screenshot_requested: Boolean(row.screenshot_requested),
          }));
        } catch {
          alertEvents = [];
        }
      }

      const aggregated = attachAlertEventsToSessions(
        aggregateSessions({
          windows: windowRows,
          urls: urlRows,
          keystrokes: keyRows,
        }),
        alertEvents,
      );
      setSessions(aggregated.map((s) => ({ ...s, agentId: agent.id })));
    } catch (err) {
      console.error("Failed to load activity data:", err);
    } finally {
      setLoading(false);
    }
  }, [agent.id]);
  useEffect(() => {
    if (activeTab === "activity" || activeTab === "live") {
      loadActivityData();
    }
  }, [activeTab, agent.id]);

  useEffect(() => {
    if (activeTab !== "activity" && activeTab !== "live") return;
    const onWsEvent = (event: Event) => {
      const detail = (event as CustomEvent<WsEvent>).detail;
      if (!detail || !("agent_id" in detail) || detail.agent_id !== agent.id) return;
      if (!("event" in detail)) return;
      const ev = detail.event;
      if (!["window_focus", "url", "keys", "afk", "active", "alert_rule_match"].includes(ev)) return;
      if (activeTabRef.current !== "activity" && activeTabRef.current !== "live") return;

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
      case "live":
        return (
          <ScreenTab
            agentId={agent.id}
            sendWsMessage={sendWsMessage}
            dashboardRole={dashboardRole}
          />
        );
      case "activity":
        return (
          <ActivityTimeline
            sessions={sessions}
            loading={loading}
            onRefresh={loadActivityData}
            highlightTimestamp={effectiveHighlightTimestamp ?? null}
          />
        );
      case "specs":
        return <SpecsTab agentId={agent.id} cachedInfo={resolvedInfo} agentOnline={agent.online} />;
      case "software":
        return (
          <SoftwareTab
            agentId={agent.id}
            onNotifyInfo={onNotifyInfo}
            onNotifyError={onNotifyError}
          />
        );
      case "scripts":
        return <ScriptsTab agentId={agent.id} dashboardRole={dashboardRole} />;
      case "keys":
        return <KeysTab agentId={agent.id} />;
      case "windows":
        return <WindowsTab agentId={agent.id} />;
      case "urls":
        return <UrlsTab agentId={agent.id} />;
      case "alerts":
        return (
          <AlertsTab
            agentId={agent.id}
            onViewTimeline={(timestamp) => {
              setTimelineHighlight(timestamp);
              onTabChange("activity");
            }}
          />
        );
      case "files":
        return <FilesTab agentId={agent.id} sendWsMessage={sendWsMessage} />;
      case "audit":
        return (
          <AuditTab
            agentId={agent.id}
            subheader="Same central audit log as Activity log (top bar), filtered to this agent."
          />
        );
      case "settings":
        return (
          <AgentSettingsTab
            agentId={agent.id}
            agentName={agent.name}
            agentOnline={agent.online}
            agentVersion={resolvedInfo?.agent_version ?? null}
            isAdmin={isAdmin}
            onOpenAgentGroups={onOpenAgentGroups}
          />
        );
      default:
        return null;
    }
  };

  const activeSection = agentSectionFromTabKey(activeTab);

  const mainTabs = AGENT_SECTION_ORDER.map((section) => {
    const content =
      activeSection === section
        ? (() => {
            if (section === "live") {
              return (
                <SpaceBetween size="l">
                  <SegmentedControl
                    label="View"
                    selectedId={activeTab}
                    options={AGENT_LIVE_SUBTABS.map((id) => ({
                      id,
                      text: id === "live" ? "Screen" : "Activity",
                    }))}
                    onChange={({ detail }) => onTabChange(detail.selectedId as TabKey)}
                  />
                  {renderTabContent(activeTab)}
                </SpaceBetween>
              );
            }
            if (section === "system") {
              return (
                <SpaceBetween size="l">
                  <SegmentedControl
                    label="System view"
                    selectedId={activeTab}
                    options={AGENT_SYSTEM_SUBTABS.map((id) => ({
                      id,
                      text: AGENT_TAB_META[id].tabLabel,
                    }))}
                    onChange={({ detail }) => onTabChange(detail.selectedId as TabKey)}
                  />
                  {renderTabContent(activeTab)}
                </SpaceBetween>
              );
            }
            if (section === "data") {
              return (
                <SpaceBetween size="l">
                  <SegmentedControl
                    label="Recorded data"
                    selectedId={activeTab}
                    options={AGENT_DATA_SUBTABS.map((id) => ({
                      id,
                      text: AGENT_TAB_META[id].tabLabel,
                    }))}
                    onChange={({ detail }) => onTabChange(detail.selectedId as TabKey)}
                  />
                  {renderTabContent(activeTab)}
                </SpaceBetween>
              );
            }
            return renderTabContent(activeTab);
          })()
        : null;

    return {
      id: section,
      label: <AgentSectionTabLabel section={section} />,
      content,
      contentRenderStrategy: "active" as const,
    };
  });

  const breadcrumbTabLabel = agentTabBreadcrumbLabel(activeTab);

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
          liveStatus={liveStatus}
          inferredIdleSeconds={inferredIdleSeconds}
          onOpenHelp={onOpenHelp}
          onRunAction={runAgentAction}
        />

        <GeneralConfig agent={agent} info={resolvedInfo} />

        <Tabs
          ariaLabel="Agent views"
          activeTabId={activeSection}
          tabs={mainTabs}
          onChange={({ detail }) => {
            const nextSection = detail.activeTabId as AgentSectionId;
            if (agentSectionFromTabKey(activeTab) === nextSection) return;
            onTabChange(defaultTabForAgentSection(nextSection));
          }}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
