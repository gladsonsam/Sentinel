import type {
  Agent,
  WindowEvent,
  KeySession,
  UrlVisit,
  ActivityEvent,
  AgentInfo,
  AgentSoftwareRow,
  RetentionPolicy,
  StorageUsage,
  UrlTopRow,
  WindowTopRow,
  LocalUiPasswordGlobalState,
  LocalUiPasswordAgentState,
} from "./types";
import { buildApiUrl } from "./serverSettings";

interface PageParams {
  limit?: number;
  offset?: number;
}

/** Paths are relative to `apiPrefix` (e.g. `/agents`, `/settings/retention`), not including `/api` twice. */
export function apiUrl(path: string): string {
  return buildApiUrl(path);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${path}`);
  return res.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postEmpty<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJsonRes<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────

  /** Check whether the current session is valid (or no password is set). */
  authStatus: async (): Promise<{
    authenticated: boolean;
    password_required: boolean;
  }> => {
    const res = await fetch(apiUrl("/auth/status"), { credentials: "include" });
    if (!res.ok && res.status !== 401) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** Submit the UI password; throws with the server error message on failure. */
  login: async (password: string): Promise<void> => {
    const res = await fetch(apiUrl("/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "include",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Login failed");
    }
  },

  /** Clear the current session cookie. */
  logout: async (): Promise<void> => {
    await fetch(apiUrl("/logout"), { method: "POST", credentials: "include" });
  },

  // ── Dashboard data ────────────────────────────────────────────────────────

  agents: (): Promise<{ agents: Agent[] }> => get("/agents"),

  windows: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: WindowEvent[] }> =>
    get(`/agents/${id}/windows?limit=${limit}&offset=${offset}`),

  keys: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: KeySession[] }> =>
    get(`/agents/${id}/keys?limit=${limit}&offset=${offset}`),

  urls: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: UrlVisit[] }> =>
    get(`/agents/${id}/urls?limit=${limit}&offset=${offset}`),

  activity: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: ActivityEvent[] }> =>
    get(`/agents/${id}/activity?limit=${limit}&offset=${offset}`),

  agentInfo: (id: string): Promise<{ info: AgentInfo | null }> =>
    get(`/agents/${id}/info`),

  topUrls: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: UrlTopRow[] }> =>
    get(`/agents/${id}/top-urls?limit=${limit}&offset=${offset}`),

  topWindows: (
    id: string,
    { limit = 100, offset = 0 }: PageParams = {},
  ): Promise<{ rows: WindowTopRow[] }> =>
    get(`/agents/${id}/top-windows?limit=${limit}&offset=${offset}`),

  // ── Destructive actions ────────────────────────────────────────────────
  /** Clear all stored telemetry history for this agent (windows/keys/urls/activity). */
  clearAgentHistory: (id: string): Promise<{ cleared_rows: number }> =>
    postEmpty(`/agents/${id}/history/clear`),

  mjpegUrl: (id: string) => apiUrl(`/agents/${id}/mjpeg`),

  // ── Retention (server) ───────────────────────────────────────────────────

  retentionGlobalGet: (): Promise<RetentionPolicy> => get("/settings/retention"),

  retentionGlobalPut: (body: RetentionPolicy): Promise<RetentionPolicy> =>
    putJson("/settings/retention", body),

  retentionAgentGet: (
    id: string,
  ): Promise<{ global: RetentionPolicy; override: RetentionPolicy | null }> =>
    get(`/agents/${id}/retention`),

  retentionAgentPut: (
    id: string,
    body: RetentionPolicy,
  ): Promise<{ global: RetentionPolicy; override: RetentionPolicy | null }> =>
    putJson(`/agents/${id}/retention`, body),

  retentionAgentDelete: (
    id: string,
  ): Promise<{ global: RetentionPolicy; override: RetentionPolicy | null }> =>
    delJson(`/agents/${id}/retention`),

  /** Wake-on-LAN using MAC from last stored system info (`POST`, optional `broadcast`, `port`). */
  wakeAgent: async (
    id: string,
    opts?: { broadcast?: string; port?: number },
  ): Promise<{ ok: boolean; mac: string; broadcast: string; port: number }> => {
    const p = new URLSearchParams();
    if (opts?.broadcast) p.set("broadcast", opts.broadcast);
    if (opts?.port != null) p.set("port", String(opts.port));
    const qs = p.toString();
    const res = await fetch(apiUrl(`/agents/${id}/wake${qs ? `?${qs}` : ""}`), {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
      mac?: string;
      broadcast?: string;
      port?: number;
      retry_after_secs?: number;
    };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return {
      ok: body.ok ?? true,
      mac: body.mac ?? "",
      broadcast: body.broadcast ?? "",
      port: body.port ?? 9,
    };
  },

  // ── Agent local settings window password (pushed to Windows agents) ───────

  localUiPasswordGlobalGet: (): Promise<LocalUiPasswordGlobalState> =>
    get("/settings/local-ui-password"),

  localUiPasswordGlobalPut: (body: {
    password: string | null;
  }): Promise<LocalUiPasswordGlobalState> =>
    putJson("/settings/local-ui-password", body),

  localUiPasswordAgentGet: (
    id: string,
  ): Promise<LocalUiPasswordAgentState> =>
    get(`/agents/${id}/local-ui-password`),

  localUiPasswordAgentPut: (
    id: string,
    body: { password: string | null },
  ): Promise<LocalUiPasswordAgentState> =>
    putJson(`/agents/${id}/local-ui-password`, body),

  localUiPasswordAgentDelete: (
    id: string,
  ): Promise<LocalUiPasswordAgentState> =>
    delJson(`/agents/${id}/local-ui-password`),

  storageUsage: (): Promise<StorageUsage> => get("/settings/storage"),

  capabilities: (): Promise<{ remote_script: boolean }> =>
    get("/settings/capabilities"),

  agentSoftware: (
    id: string,
  ): Promise<{ rows: AgentSoftwareRow[]; last_captured_at: string | null }> =>
    get(`/agents/${id}/software`),

  collectAgentSoftware: (id: string): Promise<{ ok: boolean }> =>
    postEmpty(`/agents/${id}/software/collect`),

  runAgentScript: (
    id: string,
    body: { shell: string; script: string; timeout_secs?: number },
  ): Promise<Record<string, unknown>> => postJsonRes(`/agents/${id}/script`, body),

  bulkAgentScript: (body: {
    agent_ids: string[];
    shell: string;
    script: string;
    timeout_secs?: number;
  }): Promise<{ results: Record<string, unknown>[] }> =>
    postJsonRes("/agents/bulk-script", body),
};
