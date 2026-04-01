import { useState } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import type { Agent, AgentInfo, AgentLiveStatus } from "../lib/types";
import { AgentCard } from "../components/overview/AgentCard";
import { BulkScriptModal } from "../components/overview/BulkScriptModal";
import { LoadingAgentsState, NoAgentsState } from "../components/common/EmptyState";

interface OverviewPageProps {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  agentInfo: Record<string, AgentInfo | null>;
  agentInfoReceivedAtMs: Record<string, number>;
  loadingAgents: boolean;
  onSelectAgent: (agentId: string) => void;
  onOpenScreen: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
}

export function OverviewPage({
  agents,
  liveStatus,
  agentInfo,
  agentInfoReceivedAtMs,
  loadingAgents,
  onSelectAgent,
  onOpenScreen,
  onRefresh,
  onBatchWake,
  onBatchRestart,
  onBatchShutdown,
}: OverviewPageProps) {
  const hasAgents = Object.keys(agents).length > 0;
  const [bulkScriptIds, setBulkScriptIds] = useState<string[] | null>(null);

  return (
    <ContentLayout>
      {loadingAgents ? (
        <LoadingAgentsState />
      ) : hasAgents ? (
        <AgentCard
          agents={agents}
          liveStatus={liveStatus}
          agentInfo={agentInfo}
          agentInfoReceivedAtMs={agentInfoReceivedAtMs}
          onSelectAgent={onSelectAgent}
          onOpenScreen={onOpenScreen}
          onRefresh={onRefresh}
          onBatchWake={onBatchWake}
          onBulkScript={(ids) => setBulkScriptIds(ids)}
          onBatchRestart={onBatchRestart}
          onBatchShutdown={onBatchShutdown}
        />
      ) : (
        <NoAgentsState />
      )}
      {bulkScriptIds && bulkScriptIds.length > 0 && (
        <BulkScriptModal agentIds={bulkScriptIds} onDismiss={() => setBulkScriptIds(null)} />
      )}
    </ContentLayout>
  );
}
