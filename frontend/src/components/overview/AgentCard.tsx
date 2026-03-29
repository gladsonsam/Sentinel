import { useMemo } from "react";
import Cards from "@cloudscape-design/components/cards";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import { useCollection } from "@cloudscape-design/collection-hooks";
import type { Agent, AgentLiveStatus } from "../../lib/types";
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
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
}

export function AgentCard({
  agents,
  liveStatus,
  onSelectAgent,
  onRefresh,
  onBatchRestart,
  onBatchShutdown,
}: AgentCardProps) {
  const [preferences, setPreferences] = useLocalStorage(
    "sentinel-cards-preferences",
    DEFAULT_PREFERENCES
  );

  const agentsWithStatus: AgentCardItem[] = useMemo(() => {
    return Object.entries(agents).map(([id, agent]) => ({
      ...agent,
      liveStatus: liveStatus[id],
    }));
  }, [agents, liveStatus]);

  const cardDefinition = useMemo(() => createCardDefinitions(onSelectAgent), [onSelectAgent]);

  const { items, filteredItemsCount, filterProps, collectionProps, paginationProps } = useCollection(
    agentsWithStatus,
    {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const searchText = filteringText.toLowerCase();
        return (
          item.name.toLowerCase().includes(searchText) ||
          item.id.toLowerCase().includes(searchText) ||
          (item.liveStatus?.window?.toLowerCase().includes(searchText) ?? false) ||
          (item.liveStatus?.url?.toLowerCase().includes(searchText) ?? false)
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
      visibleSections={preferences.visibleContent}
      items={items}
      selectionType="multi"
      cardsPerRow={[{ cards: 1 }, { minWidth: 600, cards: 2 }, { minWidth: 900, cards: 3 }]}
      header={
        <FullPageHeader
          totalAgents={agentsWithStatus.length}
          selectedCount={selectedItems.length}
          onRefresh={onRefresh}
          onRestartSelected={() => onBatchRestart(selectedItems.map((item) => item.id))}
          onShutdownSelected={() => onBatchShutdown(selectedItems.map((item) => item.id))}
        />
      }
      filter={
        <TextFilter
          {...filterProps}
          countText={`${filteredItemsCount} matches`}
          filteringPlaceholder="Find agents by name, window, or URL"
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
