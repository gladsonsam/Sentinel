import { useEffect, useMemo, useState } from "react";
import Cards from "@cloudscape-design/components/cards";
import Box from "@cloudscape-design/components/box";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import { useCollection } from "@cloudscape-design/collection-hooks";
import type { Agent, AgentInfo, AgentLiveStatus } from "../../lib/types";
import {
  createCardDefinitions,
  DEFAULT_PREFERENCES,
  PAGE_SIZE_OPTIONS,
  VISIBLE_CONTENT_OPTIONS,
  type AgentCardItem,
} from "../../lib/cards-config";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { FullPageHeader } from "./FullPageHeader";
import { TableEmptyState, TableNoMatchState } from "../common/CollectionStates";
import { apiUrl } from "../../lib/api";

interface AgentCardProps {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  agentInfo: Record<string, AgentInfo | null>;
  agentInfoReceivedAtMs: Record<string, number>;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBulkScript: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
}

export function AgentCard({
  agents,
  liveStatus,
  agentInfo,
  agentInfoReceivedAtMs,
  onSelectAgent,
  onRefresh,
  onBatchWake,
  onBulkScript,
  onBatchRestart,
  onBatchShutdown,
}: AgentCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [fallbackLastWindow, setFallbackLastWindow] = useState<Record<string, string>>({});
  const [fallbackUptime, setFallbackUptime] = useState<Record<string, { secs: number; receivedAtMs: number }>>({});
  const [preferences, setPreferences] = useLocalStorage(
    "sentinel-cards-preferences",
    DEFAULT_PREFERENCES
  );

  const allowedSectionIds = useMemo(() => {
    return new Set(VISIBLE_CONTENT_OPTIONS.map((o) => o.id));
  }, []);

  const visibleSections = useMemo(() => {
    const raw = preferences.visibleContent ?? DEFAULT_PREFERENCES.visibleContent;
    const migrated = raw.map((id) => {
      if (id === "window" || id === "uptime" || id === "last-seen" || id === "url") return "details";
      return id;
    });
    const cleaned = migrated.filter((id) => allowedSectionIds.has(id));
    const unique = Array.from(new Set(cleaned));

    // Ensure we don't end up with "status only" after a migration.
    if (!unique.includes("details")) unique.splice(1, 0, "details");

    const final = unique.length > 0 ? unique : DEFAULT_PREFERENCES.visibleContent;
    return final;
  }, [allowedSectionIds, preferences.visibleContent]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const onlineAgents = Object.entries(agents).filter(([, a]) => a.online);

    for (const [id] of onlineAgents) {
      // Seed "Last window" from stored telemetry if we haven't seen a live window_focus yet.
      const hasLiveWindow = Boolean(liveStatus[id]?.window);
      if (!hasLiveWindow && fallbackLastWindow[id] == null) {
        fetch(apiUrl(`/agents/${id}/windows?limit=1`), { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled || !data) return;
            const row = Array.isArray(data?.rows) ? data.rows[0] : Array.isArray(data) ? data[0] : null;
            const title = row?.window_title ?? row?.title ?? null;
            if (typeof title === "string" && title.trim() !== "") {
              setFallbackLastWindow((prev) => (prev[id] ? prev : { ...prev, [id]: title }));
            }
          })
          .catch(() => {});
      }

      // Seed uptime from stored agent info if we haven't received an agent_info WS event yet.
      const hasLiveUptime = agentInfo[id]?.uptime_secs != null;
      if (!hasLiveUptime && fallbackUptime[id] == null) {
        fetch(apiUrl(`/agents/${id}/info`), { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled || !data) return;
            const info = (data?.info ?? data) as AgentInfo | null;
            const secs = info?.uptime_secs;
            if (typeof secs === "number" && secs >= 0) {
              setFallbackUptime((prev) => (prev[id] ? prev : { ...prev, [id]: { secs, receivedAtMs: Date.now() } }));
            }
          })
          .catch(() => {});
      }
    }

    return () => {
      cancelled = true;
    };
  }, [agents, liveStatus, agentInfo, fallbackLastWindow, fallbackUptime]);

  const agentsWithStatus: AgentCardItem[] = useMemo(() => {
    return Object.entries(agents).map(([id, agent]) => ({
      ...agent,
      liveStatus: liveStatus[id],
      agentInfo: agentInfo[id],
      agentInfoReceivedAtMs: agentInfoReceivedAtMs[id],
      fallbackLastWindow: fallbackLastWindow[id],
      fallbackUptimeSecs: fallbackUptime[id]?.secs,
      fallbackUptimeReceivedAtMs: fallbackUptime[id]?.receivedAtMs,
    }));
  }, [agents, liveStatus, agentInfo, agentInfoReceivedAtMs, fallbackLastWindow, fallbackUptime]);

  const cardDefinition = useMemo(
    () => createCardDefinitions(onSelectAgent, nowMs),
    [onSelectAgent, nowMs]
  );

  const { items, filteredItemsCount, filterProps, collectionProps, paginationProps } = useCollection(
    agentsWithStatus,
    {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const searchText = filteringText.toLowerCase();
        const detailsWindow = (item.liveStatus?.window || item.fallbackLastWindow || "").toLowerCase();
        return (
          item.name.toLowerCase().includes(searchText) ||
          item.id.toLowerCase().includes(searchText) ||
          (detailsWindow.includes(searchText) ?? false)
        );
      },
    },
    sorting: {
      defaultState: {
        sortingColumn: {
          sortingField: "online",
        },
        isDescending: true,
      },
    },
    pagination: { pageSize: preferences.pageSize },
    selection: {},
  });

  const selectedItems = collectionProps.selectedItems || [];

  return (
    <Cards
      {...collectionProps}
      variant="full-page"
      stickyHeader
      cardDefinition={cardDefinition}
      visibleSections={visibleSections}
      items={items}
      selectionType="multi"
      cardsPerRow={[{ cards: 1 }, { minWidth: 600, cards: 2 }, { minWidth: 900, cards: 3 }]}
      header={
        <Box padding={{ bottom: "m" }}>
          <FullPageHeader
            totalAgents={agentsWithStatus.length}
            selectedCount={selectedItems.length}
            onRefresh={onRefresh}
            onWakeSelected={() => onBatchWake(selectedItems.map((item) => item.id))}
            onBulkScript={() => onBulkScript(selectedItems.map((item) => item.id))}
            onRestartSelected={() => onBatchRestart(selectedItems.map((item) => item.id))}
            onShutdownSelected={() => onBatchShutdown(selectedItems.map((item) => item.id))}
          />
        </Box>
      }
      filter={
        <TextFilter
          {...filterProps}
          countText={`${filteredItemsCount} matches`}
          filteringPlaceholder="Find agents by name, window, or uptime"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      preferences={
        <CollectionPreferences
          title="Preferences"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          preferences={preferences}
          pageSizePreference={{
            title: "Page size",
            options: PAGE_SIZE_OPTIONS,
          }}
          visibleContentPreference={{
            title: "Visible sections",
            options: [{ label: "Agent information", options: VISIBLE_CONTENT_OPTIONS }],
          }}
          onConfirm={({ detail }) =>
            setPreferences({
              pageSize: detail.pageSize ?? DEFAULT_PREFERENCES.pageSize,
              visibleContent: [
                ...(detail.visibleContent ?? DEFAULT_PREFERENCES.visibleContent),
              ],
            })
          }
        />
      }
      empty={
        filterProps.filteringText ? (
          <TableNoMatchState
            onClearFilter={() =>
              filterProps.onChange({
                detail: { filteringText: "" },
              } as any)
            }
          />
        ) : (
          <TableEmptyState
            title="No agents"
            subtitle="No agents are connected right now."
            actionText="Refresh"
            onActionClick={onRefresh}
          />
        )
      }
    />
  );
}
