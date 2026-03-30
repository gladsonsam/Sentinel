import { useState } from "react";
import ContentLayout from "@cloudscape-design/components/content-layout";
import type { Agent, AgentLiveStatus } from "../lib/types";
import { AgentCard } from "../components/overview/AgentCard";
import { BulkScriptModal } from "../components/overview/BulkScriptModal";
import { NoAgentsState } from "../components/common/EmptyState";

interface OverviewPageProps {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onBatchWake: (agentIds: string[]) => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
}

export function OverviewPage({
  agents,
  liveStatus,
  onSelectAgent,
  onRefresh,
  onBatchWake,
  onBatchRestart,
  onBatchShutdown,
}: OverviewPageProps) {
  const hasAgents = Object.keys(agents).length > 0;
  const [bulkScriptIds, setBulkScriptIds] = useState<string[] | null>(null);

  return (
    <ContentLayout>
      {hasAgents ? (
        <AgentCard
          agents={agents}
          liveStatus={liveStatus}
          onSelectAgent={onSelectAgent}
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
