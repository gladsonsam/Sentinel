// Compatibility layer for API and type conversions

import { api as apiObject, apiUrl } from "./api";
import type { Agent, AgentLiveStatus } from "./types";

// Re-export apiUrl for components
export { apiUrl };

// Re-export api object
export const api = apiObject;

// Type guards and converters
export function agentIsConnected(agent: Agent): boolean {
  return agent.online;
}

export function normalizeAgentLiveStatus(status: AgentLiveStatus | undefined): {
  last_window?: string;
  last_url?: string;
  is_afk: boolean;
  idle_seconds?: number;
} {
  if (!status) {
    return { is_afk: false };
  }
  
  return {
    last_window: status.window,
    last_url: status.url,
    is_afk: status.activity === "afk",
    idle_seconds: status.idleSecs,
  };
}

// Export for backward compatibility
export { Agent, AgentLiveStatus };
