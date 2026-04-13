import { useEffect, useMemo, useState } from "react";
import Cards from "@cloudscape-design/components/cards";
import Box from "@cloudscape-design/components/box";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import Modal from "@cloudscape-design/components/modal";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useCollection } from "@cloudscape-design/collection-hooks";
import type { Agent, AgentInfo, AgentLiveStatus } from "../../lib/types";
import {
  createCardDefinitions,
  type AgentCardItem,
} from "../../lib/cards-config";
import { FullPageHeader } from "./FullPageHeader";
import { TableEmptyState, TableNoMatchState } from "../common/CollectionStates";
import { apiUrl } from "../../lib/api";

interface AgentCardProps {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  agentInfo: Record<string, AgentInfo | null>;
  agentInfoReceivedAtMs: Record<string, number>;
  onSelectAgent: (agentId: string) => void;
  onOpenScreen: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBulkScript: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
  /** Admin: opens group picker to add all selected agents to a group. */
  onBulkAddToGroup?: (agentIds: string[]) => void;
  /** Admin: open add-agent / enrollment flow. */
  onAddAgent?: () => void;
  /** Admin: delete agents from the server (forget). */
  onDeleteAgents?: (agentIds: string[]) => void;
}

export function AgentCard({
  agents,
  liveStatus,
  agentInfo,
  agentInfoReceivedAtMs,
  onSelectAgent,
  onOpenScreen,
  onRefresh,
  onBatchWake,
  onBulkScript,
  onBatchRestart,
  onBatchShutdown,
  onBulkAddToGroup,
  onAddAgent,
  onDeleteAgents,
}: AgentCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [fallbackLastWindow, setFallbackLastWindow] = useState<Record<string, string>>({});
  const [fallbackUptime, setFallbackUptime] = useState<Record<string, { secs: number; receivedAtMs: number }>>({});
  const [powerModal, setPowerModal] = useState<null | { agentId: string }>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "connected" | "disconnected" | "afk">("all");

  // Dev-friendly defaults: avoid persisting card preferences in localStorage.
  const visibleSections = useMemo(
    () => ["main"],
    [],
  );
  const pageSize = 12;

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const allAgents = Object.entries(agents);

    for (const [id, agent] of allAgents) {
      // Seed "Last window" from stored telemetry if we haven't seen a live window_focus yet.
      // Do this for offline agents too so cards stay aligned.
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
      if (agent.online && !hasLiveUptime && fallbackUptime[id] == null) {
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
    () =>
      createCardDefinitions(
        onSelectAgent,
        onOpenScreen,
        (agentId) => setPowerModal({ agentId }),
        nowMs
      ),
    [onSelectAgent, onOpenScreen, nowMs]
  );

  const { items, filteredItemsCount, filterProps, collectionProps, paginationProps } = useCollection(
    agentsWithStatus,
    {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const searchText = filteringText.toLowerCase();
        const detailsWindow = (item.liveStatus?.window || item.fallbackLastWindow || "").toLowerCase();
        const hostname = (item.agentInfo?.hostname || "").toLowerCase();

        const statusOk =
          statusFilter === "all"
            ? true
            : statusFilter === "connected"
              ? item.online
              : statusFilter === "disconnected"
                ? !item.online
                : item.online && item.liveStatus?.activity === "afk";

        if (!statusOk) return false;
        return (
          item.name.toLowerCase().includes(searchText) ||
          item.id.toLowerCase().includes(searchText) ||
          hostname.includes(searchText) ||
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
    pagination: { pageSize },
    selection: {},
  });

  const selectedItems = collectionProps.selectedItems || [];
  const modalAgent = powerModal?.agentId ? agents[powerModal.agentId] : null;
  const modalOnline = powerModal?.agentId ? Boolean(agents[powerModal.agentId]?.online) : false;
  const modalTitle = modalAgent?.name ?? powerModal?.agentId ?? "";

  return (
    <>
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
          <Box padding={{ bottom: "m" }} className="sentinel-overview-cards-header">
            <FullPageHeader
              totalAgents={agentsWithStatus.length}
              selectedCount={selectedItems.length}
              onRefresh={onRefresh}
              onWakeSelected={() => onBatchWake(selectedItems.map((item) => item.id))}
              onBulkScript={() => onBulkScript(selectedItems.map((item) => item.id))}
              onRestartSelected={() => onBatchRestart(selectedItems.map((item) => item.id))}
              onShutdownSelected={() => onBatchShutdown(selectedItems.map((item) => item.id))}
              onDeleteSelected={
                onDeleteAgents
                  ? () => {
                      const ids = selectedItems.map((i) => i.id);
                      if (ids.length === 0) return;
                      if (
                        !confirm(
                          `Delete (forget) ${ids.length} agent${ids.length === 1 ? "" : "s"} from the server? This deletes stored telemetry and disconnects existing installs.`
                        )
                      ) {
                        return;
                      }
                      onDeleteAgents(ids);
                    }
                  : undefined
              }
              onBulkAddToGroup={
                onBulkAddToGroup
                  ? () => onBulkAddToGroup(selectedItems.map((item) => item.id))
                  : undefined
              }
              onAddAgent={onAddAgent}
            />
          </Box>
        }
        filter={
          <SpaceBetween size="s">
            <SegmentedControl
              label="Filters"
              selectedId={statusFilter}
              options={[
                { id: "all", text: "All" },
                { id: "connected", text: "Connected" },
                { id: "disconnected", text: "Disconnected" },
                { id: "afk", text: "AFK" },
              ]}
              onChange={({ detail }) =>
                setStatusFilter(detail.selectedId as typeof statusFilter)
              }
            />
            <TextFilter
              {...filterProps}
              countText={`${filteredItemsCount} matches`}
              filteringPlaceholder="Search agents…"
            />
          </SpaceBetween>
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          filterProps.filteringText || statusFilter !== "all" ? (
            <TableNoMatchState
              onClearFilter={() => {
                setStatusFilter("all");
                filterProps.onChange({
                  detail: { filteringText: "" },
                } as Parameters<typeof filterProps.onChange>[0])
              }}
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

      <Modal
        visible={Boolean(powerModal)}
        onDismiss={() => setPowerModal(null)}
        header={modalOnline ? "Confirm shutdown" : "Confirm wake"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPowerModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!powerModal?.agentId) return;
                  const id = powerModal.agentId;
                  setPowerModal(null);
                  if (agents[id]?.online) onBatchShutdown([id]);
                  else onBatchWake([id]);
                }}
              >
                {modalOnline ? "Shutdown" : "Wake"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>
            {modalOnline
              ? `Send a shutdown command to "${modalTitle}"?`
              : `Send a Wake-on-LAN packet to "${modalTitle}"?`}
          </Box>
        </SpaceBetween>
      </Modal>
    </>
  );
}
