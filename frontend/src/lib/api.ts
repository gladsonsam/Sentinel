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
  DashboardUser,
  DashboardIdentity,
  DashboardRole,
  AgentGroup,
  AlertRule,
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

/** Per-tab CSRF secret from login or `GET /api/me`; sent as `X-CSRF-Token` on mutating requests. */
let dashboardCsrfToken: string | null = null;

export function setDashboardCsrfToken(token: string | null): void {
  dashboardCsrfToken = token;
}

function csrfHeaders(): Record<string, string> {
  if (!dashboardCsrfToken) return {};
  return { "X-CSRF-Token": dashboardCsrfToken };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${path}`);
  return res.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
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
    headers: { ...csrfHeaders() },
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
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
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
    headers: { ...csrfHeaders() },
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

  /** Submit credentials; throws with the server error message on failure. */
  login: async (username: string, password: string): Promise<void> => {
    const res = await fetch(apiUrl("/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Login failed");
    }
    const data = (await res.json().catch(() => ({}))) as { csrf_token?: string };
    if (typeof data.csrf_token === "string" && data.csrf_token.length > 0) {
      setDashboardCsrfToken(data.csrf_token);
    }
  },

  /** Clear the current session cookie. */
  logout: async (): Promise<void> => {
    await fetch(apiUrl("/logout"), { method: "POST", credentials: "include" });
    setDashboardCsrfToken(null);
  },

  me: (): Promise<{ id: string; username: string; role: "admin" | "operator" | "viewer" }> =>
    get("/me"),

  // ── Dashboard data ────────────────────────────────────────────────────────

  agents: (): Promise<{ agents: Agent[] }> => get("/agents"),

  // ── Agent UI metadata ─────────────────────────────────────────────────────

  agentIconGet: (id: string): Promise<{ icon: string | null }> =>
    get(`/agents/${id}/icon`),

  agentIconPut: (id: string, icon: string | null): Promise<{ icon: string | null }> =>
    putJson(`/agents/${id}/icon`, { icon }),

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
      headers: { ...csrfHeaders() },
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
    params?: { limit?: number; offset?: number },
  ): Promise<{
    rows: AgentSoftwareRow[];
    last_captured_at: string | null;
    total?: number;
    limit?: number;
    offset?: number;
  }> => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return get(`/agents/${id}/software${q ? `?${q}` : ""}`);
  },

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

  // ── Admin: users / identities ─────────────────────────────────────────────

  usersList: (): Promise<{ users: DashboardUser[] }> => get("/users"),

  userCreate: (body: {
    username: string;
    password: string;
    role: DashboardRole;
  }): Promise<{ id: string }> => postJsonRes("/users", body),

  userSetPassword: (id: string, password: string): Promise<{ ok: boolean }> =>
    postJsonRes(`/users/${id}/password`, { password }),

  userSetRole: (id: string, role: DashboardRole): Promise<{ ok: boolean }> =>
    postJsonRes(`/users/${id}/role`, { role }),

  userDelete: (id: string): Promise<{ ok: boolean }> =>
    postEmpty(`/users/${id}/delete`),

  userIdentities: (id: string): Promise<{ identities: DashboardIdentity[] }> =>
    get(`/users/${id}/identities`),

  userIdentityLink: (
    id: string,
    body: { issuer: string; subject: string },
  ): Promise<{ ok: boolean }> => postJsonRes(`/users/${id}/identities/link`, body),

  identityUnlink: (identityId: number): Promise<{ ok: boolean }> =>
    postEmpty(`/identities/${identityId}/unlink`),

  // ── Admin: agent groups & alert rules (URL / keystroke notifications) ───────

  agentGroupsList: (): Promise<{ groups: AgentGroup[] }> => get("/agent-groups"),

  agentGroupsCreate: (body: {
    name: string;
    description?: string;
  }): Promise<{ id: string }> => postJsonRes("/agent-groups", body),

  agentGroupsUpdate: (
    id: string,
    body: { name: string; description?: string },
  ): Promise<{ ok: boolean }> => putJson(`/agent-groups/${id}`, body),

  agentGroupsDelete: (id: string): Promise<{ ok: boolean }> =>
    delJson(`/agent-groups/${id}`),

  agentGroupMembers: (groupId: string): Promise<{ agent_ids: string[] }> =>
    get(`/agent-groups/${groupId}/members`),

  agentGroupMembersAdd: (
    groupId: string,
    body: { agent_ids: string[] },
  ): Promise<{ added: number }> =>
    postJsonRes(`/agent-groups/${groupId}/members`, body),

  agentGroupMemberRemove: (
    groupId: string,
    agentId: string,
  ): Promise<{ ok: boolean }> =>
    delJson(`/agent-groups/${groupId}/members/${agentId}`),

  alertRulesList: (): Promise<{ rules: AlertRule[] }> => get("/alert-rules"),

  alertRulesCreate: (body: {
    name: string;
    channel: string;
    pattern: string;
    match_mode: string;
    case_insensitive: boolean;
    cooldown_secs: number;
    enabled: boolean;
    take_screenshot?: boolean;
    scopes: { kind: string; group_id?: string; agent_id?: string }[];
  }): Promise<{ id: number }> => postJsonRes("/alert-rules", body),

  alertRulesUpdate: (
    id: number,
    body: {
      name: string;
      channel: string;
      pattern: string;
      match_mode: string;
      case_insensitive: boolean;
      cooldown_secs: number;
      enabled: boolean;
      take_screenshot?: boolean;
      scopes: { kind: string; group_id?: string; agent_id?: string }[];
    },
  ): Promise<{ ok: boolean }> => putJson(`/alert-rules/${id}`, body),

  alertRulesDelete: (id: number): Promise<{ ok: boolean }> =>
    delJson(`/alert-rules/${id}`),

  alertRuleEvents: (
    ruleId: number,
    params?: { limit?: number; offset?: number },
  ): Promise<{ rows: Record<string, unknown>[] }> => {
    const q = new URLSearchParams();
    q.set("limit", String(params?.limit ?? 500));
    q.set("offset", String(params?.offset ?? 0));
    return get(`/alert-rules/${ruleId}/events?${q.toString()}`);
  },

  agentAlertRuleEvents: (
    agentId: string,
    params?: { limit?: number; offset?: number },
  ): Promise<{ rows: Record<string, unknown>[] }> => {
    const q = new URLSearchParams();
    q.set("limit", String(params?.limit ?? 500));
    q.set("offset", String(params?.offset ?? 0));
    return get(`/agents/${agentId}/alert-rule-events?${q.toString()}`);
  },
};

