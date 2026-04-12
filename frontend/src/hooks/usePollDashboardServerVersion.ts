import { useEffect } from "react";
import { api, SETTINGS_VERSION_POLL_INTERVAL_MS } from "../lib/api";

/** Keeps `useServerVersionPayload()` fresh while the dashboard shell is mounted. */
export function usePollDashboardServerVersion(): void {
  useEffect(() => {
    const load = () => {
      void api.settingsVersionGet().catch(() => {});
    };
    load();
    const id = window.setInterval(load, SETTINGS_VERSION_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);
}
