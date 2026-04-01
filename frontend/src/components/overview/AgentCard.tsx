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
  const [preferences, setPreferences] = useLocalStorage(
    "sentinel-cards-preferences",
    DEFAULT_PREFERENCES
  );

  const allowedSectionIds = useMemo(() => {
    return new Set(VISIBLE_CONTENT_OPTIONS.map((o) => o.id));
  }, []);

  const visibleSections = useMemo(() => {
    const raw = preferences.visibleContent ?? DEFAULT_PREFERENCES.visibleContent;
    const cleaned = raw.filter((id) => allowedSectionIds.has(id));
    return cleaned.length > 0 ? cleaned : DEFAULT_PREFERENCES.visibleContent;
  }, [allowedSectionIds, preferences.visibleContent]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const agentsWithStatus: AgentCardItem[] = useMemo(() => {
    return Object.entries(agents).map(([id, agent]) => ({
      ...agent,
      liveStatus: liveStatus[id],
      agentInfo: agentInfo[id],
      agentInfoReceivedAtMs: agentInfoReceivedAtMs[id],
    }));
  }, [agents, liveStatus, agentInfo, agentInfoReceivedAtMs]);

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
        return (
          item.name.toLowerCase().includes(searchText) ||
          item.id.toLowerCase().includes(searchText) ||
          (item.liveStatus?.window?.toLowerCase().includes(searchText) ?? false)
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
