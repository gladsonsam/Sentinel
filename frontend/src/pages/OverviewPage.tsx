import ContentLayout from "@cloudscape-design/components/content-layout";
import type { Agent, AgentLiveStatus } from "../lib/types";
import { AgentCard } from "../components/overview/AgentCard";
import { NoAgentsState } from "../components/common/EmptyState";

interface OverviewPageProps {
  agents: Record<string, Agent>;
  liveStatus: Record<string, AgentLiveStatus>;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onBatchRestart: (agentIds: string[]) => void;
  onBatchShutdown: (agentIds: string[]) => void;
}

export function OverviewPage({
  agents,
  liveStatus,
  onSelectAgent,
  onRefresh,
  onBatchRestart,
  onBatchShutdown,
}: OverviewPageProps) {
  const hasAgents = Object.keys(agents).length > 0;

  return (
    <ContentLayout>
      {hasAgents ? (
        <AgentCard
          agents={agents}
          liveStatus={liveStatus}
          onSelectAgent={onSelectAgent}
          onRefresh={onRefresh}
          onBatchRestart={onBatchRestart}
          onBatchShutdown={onBatchShutdown}
        />
      ) : (
        <NoAgentsState />
      )}
    </ContentLayout>
  );
}
