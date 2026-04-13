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
  DashboardSessionUser,
  DashboardIdentity,
  DashboardRole,
  AgentGroup,
  AgentGroupMembership,
  AlertRule,
} from "./types";
import { buildApiUrl } from "./serverSettings";
import { publishServerVersion, type SettingsVersionPayload } from "./serverVersionStore";

interface PageParams {
  limit?: number;
  offset?: number;
}

/** Paths are relative to `apiPrefix` (e.g. `/agents`, `/settings/retention`), not including `/api` twice. */
export function apiUrl(path: string): string {
  return buildApiUrl(path);
}

/** Per-tab CSRF token (`sessionStorage` isolates concurrent logins across browser tabs). */
const CSRF_STORAGE_KEY = "sentinel.dashboard.csrf";

export function setDashboardCsrfToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    else sessionStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // Storage disabled — CSRF-protected mutating calls may fail until login succeeds again.
  }
}

function csrfHeaders(): Record<string, string> {
  try {
    const t = sessionStorage.getItem(CSRF_STORAGE_KEY);
    if (!t) return {};
    return { "X-CSRF-Token": t };
  } catch {
    return {};
  }
}

/** Multipart MJPEG URL; `session` must match {@link notifyMjpegViewerLeft}. */
export function mjpegStreamUrl(agentId: string, session: string): string {
  return apiUrl(`/agents/${agentId}/mjpeg?session=${encodeURIComponent(session)}`);
}

/** Tell the server this dashboard tab stopped viewing live screen (sends `stop_capture` when last viewer). */
export function notifyMjpegViewerLeft(agentId: string, session: string): void {
  if (!session) return;
  void fetch(apiUrl(`/agents/${agentId}/mjpeg/leave`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ session }),
    credentials: "include",
    keepalive: true,
  }).catch(() => {
    /* best-effort */
  });
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  const ct = res.headers.get("Content-Type") ?? "";
  if (!res.ok) {
    if (ct.includes("application/json")) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `HTTP ${res.status} – ${path}`);
    }
    const text = await res.text().catch(() => "");
    throw new Error(text.trim() || `HTTP ${res.status} – ${path}`);
  }
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON from ${path}; got ${ct || "unknown type"}: ${text.slice(0, 200)}`,
    );
  }
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

  me: (): Promise<DashboardSessionUser> => get("/me"),

  // ── Dashboard data ────────────────────────────────────────────────────────

  agents: (): Promise<{ agents: Agent[] }> => get("/agents"),

  // ── Agent UI metadata ─────────────────────────────────────────────────────

  agentIconGet: (id: string): Promise<{ icon: string | null }> =>
    get(`/agents/${id}/icon`),

  agentIconPut: (id: string, icon: string | null): Promise<{ icon: string | null }> =>
    putJson(`/agents/${id}/icon`, { icon }),

  /** Admin: groups this agent belongs to. */
  agentGroupsForAgent: (id: string): Promise<{ groups: AgentGroupMembership[] }> =>
    get(`/agents/${id}/groups`),

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

  /** @deprecated Use {@link mjpegStreamUrl} with a per-tab `session` UUID. */
  mjpegUrl: (id: string, session: string) => mjpegStreamUrl(id, session),

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

  // ── Agent auto-update policy (pushed to Windows agents) ────────────────────

  agentAutoUpdateGlobalGet: (): Promise<{ enabled: boolean }> =>
    get("/settings/agent-auto-update"),

  agentAutoUpdateGlobalPut: (body: { enabled: boolean }): Promise<{ enabled: boolean }> =>
    putJson("/settings/agent-auto-update", body),

  agentAutoUpdateAgentGet: (
    id: string,
  ): Promise<{ global: { enabled: boolean }; override: { enabled: boolean } | null }> =>
    get(`/agents/${id}/auto-update`),

  agentAutoUpdateAgentPut: (
    id: string,
    body: { enabled: boolean },
  ): Promise<{ global: { enabled: boolean }; override: { enabled: boolean } | null }> =>
    putJson(`/agents/${id}/auto-update`, body),

  agentAutoUpdateAgentDelete: (
    id: string,
  ): Promise<{ global: { enabled: boolean }; override: { enabled: boolean } | null }> =>
    delJson(`/agents/${id}/auto-update`),

  agentUpdateNow: (id: string): Promise<{ ok: boolean }> =>
    postEmpty(`/agents/${id}/update-now`),

  /** Admin: LAN mDNS mode and agent WSS URL for onboarding (mirrors server `mdns_broadcast` rules). */
  getAgentSetupHints: (): Promise<{
    mdns: "advertising" | "disabled_by_env" | "unavailable_no_wss_url";
    agent_wss_url: string | null;
    mdns_port: number;
  }> => get("/settings/agent-setup-hints"),

  /** Admin: create a 6-digit (or multi-use) enrollment code for Windows agent adoption. */
  createAgentEnrollmentToken: (body: {
    uses?: number;
    expires_in_hours?: number | null;
    note?: string | null;
  }): Promise<{
    id: string;
    enrollment_token: string;
    uses: number;
    expires_at: string | null;
    note?: string | null;
  }> => postJsonRes("/settings/agent-enrollment-tokens", body),

  /** Admin: list enrollment tokens (metadata only; plaintext code is shown once at creation). */
  listAgentEnrollmentTokens: (): Promise<{
    tokens: {
      id: string;
      uses_remaining: number;
      created_at: string;
      expires_at: string | null;
      note: string | null;
      used_count: number;
      last_used_at: string | null;
    }[];
  }> => get("/settings/agent-enrollment-tokens"),

  /** Admin: revoke an enrollment token (sets uses_remaining = 0). */
  revokeAgentEnrollmentToken: (id: string): Promise<{ ok: boolean }> =>
    delJson(`/settings/agent-enrollment-tokens/${encodeURIComponent(id)}`),

  /** Admin: revoke all enrollment tokens. */
  revokeAllAgentEnrollmentTokens: (): Promise<{ ok: boolean; revoked: number }> =>
    postEmpty("/settings/agent-enrollment-tokens/revoke-all"),

  /** Admin: list recent uses of an enrollment token. */
  listAgentEnrollmentTokenUses: (id: string): Promise<{
    uses: { used_at: string; agent_name: string; agent_id: string | null }[];
  }> => get(`/settings/agent-enrollment-tokens/${encodeURIComponent(id)}/uses`),

  /** Admin: reset an agent’s saved token so it can enroll again. */
  revokeAgentCredentials: (agentId: string): Promise<{ ok: boolean }> =>
    postEmpty(`/agents/${encodeURIComponent(agentId)}/revoke-credentials`),

  /** Admin: delete agents (forgets them). */
  deleteAgents: (agentIds: string[]): Promise<{ ok: boolean; deleted: number }> =>
    postJsonRes("/agents/delete", { agent_ids: agentIds }),

  settingsVersionGet: async (opts?: { nocache?: boolean }): Promise<SettingsVersionPayload> => {
    const qs = opts?.nocache ? "?nocache=true" : "";
    const result = await get<SettingsVersionPayload>(`/settings/version${qs}`);
    publishServerVersion(result);
    return result;
  },

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

  agentLogSources: (
    id: string,
  ): Promise<{
    sources: { id: string; label: string; path: string }[];
  }> =>
    get(`/agents/${id}/logs/sources`).then((r: any) => ({
      sources: Array.isArray(r?.sources)
        ? r.sources.map((s: any) => ({
            id: String(s?.id ?? ""),
            label: String(s?.label ?? s?.id ?? ""),
            path: String(s?.path ?? ""),
          }))
        : [],
    })),

  agentLogTail: (
    id: string,
    params?: { kind?: string; maxKb?: number },
  ): Promise<{ kind: string; text: string }> => {
    const q = new URLSearchParams();
    if (params?.kind) q.set("kind", params.kind);
    if (params?.maxKb != null) q.set("max_kb", String(params.maxKb));
    const qs = q.toString();
    return get(`/agents/${id}/logs/tail${qs ? `?${qs}` : ""}`).then((r: any) => ({
      kind: String(r?.kind ?? params?.kind ?? ""),
      text: String(r?.text ?? ""),
    }));
  },

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
    display_name?: string;
  }): Promise<{ id: string }> => postJsonRes("/users", body),

  userSetPassword: (id: string, password: string): Promise<{ ok: boolean }> =>
    postJsonRes(`/users/${id}/password`, { password }),

  userSetRole: (id: string, role: DashboardRole): Promise<{ ok: boolean }> =>
    postJsonRes(`/users/${id}/role`, { role }),

  userUpdateProfile: (
    id: string,
    body: { username?: string; display_name?: string; display_icon?: string | null },
  ): Promise<{
    ok: boolean;
    id: string;
    username: string;
    display_name: string;
    display_icon: string | null;
  }> => postJsonRes(`/users/${id}/profile`, body),

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

/** How often the UI should call `settingsVersionGet` (server caches GitHub for a similar window). */
export const SETTINGS_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
