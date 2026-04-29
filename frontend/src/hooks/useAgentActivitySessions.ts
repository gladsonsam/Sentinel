import { useCallback, useEffect, useRef, useState } from "react";
import type { TabKey, WsEvent } from "../lib/types";
import { api } from "../lib/api";
import {
  aggregateSessions,
  attachAlertEventsToSessions,
  type Session,
  type SessionAlertEvent,
} from "../lib/session-aggregator";
import { parseTimestamp } from "../lib/utils";

const REFRESH_EVENTS = new Set([
  "window_focus",
  "url",
  "keys",
  "afk",
  "active",
  "alert_rule_match",
]);

/**
 * Loads merged timeline sessions when the Live / Activity tabs are active,
 * and debounces refreshes on relevant agent WebSocket events.
 */
export function useAgentActivitySessions(agentId: string, activeTab: TabKey) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const loadActivityData = useCallback(async () => {
    try {
      setLoading(true);

      const [windowsRes, urlsRes, keysRes, alertsRes] = await Promise.allSettled([
        api.windows(agentId, { limit: 500 }),
        api.urls(agentId, { limit: 500 }),
        api.keys(agentId, { limit: 500 }),
        api.agentAlertRuleEvents(agentId, { limit: 500, offset: 0 }),
      ]);

      const windows =
        windowsRes.status === "fulfilled" ? windowsRes.value.rows : [];
      const urls = urlsRes.status === "fulfilled" ? urlsRes.value.rows : [];
      const keystrokes = keysRes.status === "fulfilled" ? keysRes.value.rows : [];

      const windowRows = windows
        .map((row) => ({
          id: row.hwnd,
          window_title: row.title,
          exe_name: row.app,
          app_display: row.app,
          timestamp: row.ts || row.created,
          user: row.user ?? null,
        }))
        .filter((row) => parseTimestamp(row.timestamp));

      const urlRows = urls
        .map((row) => ({
          id: row.id ?? 0,
          url: row.url,
          browser: row.browser,
          timestamp: row.ts,
          user: row.user ?? null,
        }))
        .filter((row) => parseTimestamp(row.timestamp));

      const keyRows = keystrokes
        .map((row) => ({
          id: 0,
          window_title: row.window_title,
          exe_name: row.app,
          app_display: row.app,
          keys: row.text,
          timestamp: row.updated_at || row.started_at,
          user: row.user ?? null,
        }))
        .filter((row) => parseTimestamp(row.timestamp));

      let alertEvents: SessionAlertEvent[] = [];
      if (alertsRes.status === "fulfilled") {
        try {
          const alertRows = alertsRes.value.rows;
          alertEvents = alertRows.map((row) => ({
            id: Number(row.id ?? 0),
            rule_name: String(row.rule_name ?? ""),
            channel: String(row.channel ?? ""),
            snippet: String(row.snippet ?? ""),
            created_at: String(row.created_at ?? ""),
            has_screenshot: Boolean(row.has_screenshot),
            screenshot_requested: Boolean(row.screenshot_requested),
          }));
        } catch {
          alertEvents = [];
        }
      }

      const aggregated = attachAlertEventsToSessions(
        aggregateSessions({
          windows: windowRows,
          urls: urlRows,
          keystrokes: keyRows,
        }),
        alertEvents,
      );
      setSessions(aggregated.map((s) => ({ ...s, agentId })));
    } catch (err) {
      console.error("Failed to load activity data:", err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (activeTab === "activity" || activeTab === "live") {
      void loadActivityData();
    }
  }, [activeTab, agentId, loadActivityData]);

  useEffect(() => {
    if (activeTab !== "activity" && activeTab !== "live") return;
    const onWsEvent = (event: Event) => {
      const detail = (event as CustomEvent<WsEvent>).detail;
      if (!detail || !("agent_id" in detail) || detail.agent_id !== agentId) return;
      if (!("event" in detail)) return;
      const ev = detail.event;
      if (!REFRESH_EVENTS.has(ev)) return;
      if (activeTabRef.current !== "activity" && activeTabRef.current !== "live") return;

      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }
      refreshDebounceRef.current = setTimeout(() => {
        void loadActivityData();
      }, 500);
    };

    window.addEventListener("sentinel-ws-event", onWsEvent as EventListener);
    return () => {
      window.removeEventListener("sentinel-ws-event", onWsEvent as EventListener);
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
    };
  }, [activeTab, agentId, loadActivityData]);

  return { sessions, loading, loadActivityData };
}
