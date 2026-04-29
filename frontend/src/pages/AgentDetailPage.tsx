import { useState, useCallback } from "react";
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
import type { TabKey, DashboardRole } from "../lib/types";
import { api } from "../lib/api";
import type { Agent, AgentInfo, AgentLiveStatus } from "../lib/types";
import { PageHeader, type AgentAction } from "../components/detail/PageHeader";
import { GeneralConfig } from "../components/detail/GeneralConfig";
import { AgentDetailTabContent } from "../components/detail/AgentDetailTabContent";
import { useAgentActivitySessions } from "../hooks/useAgentActivitySessions";
import { useAgentInferredIdle } from "../hooks/useAgentInferredIdle";
import { useResolvedAgentInfo } from "../hooks/useResolvedAgentInfo";

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
  /** Merge refreshed agent info into local UI and the global agent cache (overview, WS parity). */
  onAgentInfoCommit?: (agentId: string, info: AgentInfo | null) => void;
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
  onAgentInfoCommit,
}: AgentDetailPageProps) {
  /** Timestamp set when user clicks "View in Timeline" from the Alerts tab (overrides URL param) */
  const [timelineHighlight, setTimelineHighlight] = useState<string | null>(null);
  const { resolvedInfo, setResolvedInfo } = useResolvedAgentInfo(agent.id, agentInfo);
  const inferredIdleSeconds = useAgentInferredIdle(agent.id, liveStatus?.activity);
  const { sessions, loading, loadActivityData } = useAgentActivitySessions(agent.id, activeTab);

  // Merge prop-based highlightTimestamp (from URL ?at=) with local state
  const effectiveHighlightTimestamp = timelineHighlight ?? highlightTimestamp;

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

  const renderTabContent = (tab: TabKey) => (
    <AgentDetailTabContent
      tab={tab}
      agent={agent}
      dashboardRole={dashboardRole}
      sendWsMessage={sendWsMessage}
      onNotifyInfo={onNotifyInfo}
      onNotifyError={onNotifyError}
      isAdmin={isAdmin}
      onOpenAgentGroups={onOpenAgentGroups}
      resolvedInfo={resolvedInfo}
      sessions={sessions}
      activityLoading={loading}
      onRefreshActivity={loadActivityData}
      highlightTimestamp={effectiveHighlightTimestamp ?? null}
      onViewTimelineFromAlerts={(timestamp) => {
        setTimelineHighlight(timestamp);
        onTabChange("activity");
      }}
    />
  );

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

        <GeneralConfig
          agent={agent}
          info={resolvedInfo}
          onAgentInfoRefreshed={(next) => {
            setResolvedInfo(next);
            onAgentInfoCommit?.(agent.id, next);
          }}
        />

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
