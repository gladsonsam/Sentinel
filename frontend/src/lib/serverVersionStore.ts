import { useSyncExternalStore } from "react";

/** Payload from `GET /settings/version` (shared across dashboard). */
export interface SettingsVersionPayload {
  server_version: string;
  latest_server_release: string | null;
  server_update_available: boolean;
  latest_agent_version: string | null;
  releases_url: string;
}

const EMPTY_SNAPSHOT = { data: null as SettingsVersionPayload | null, version: 0 };

let snapshot: { data: SettingsVersionPayload | null; version: number } = EMPTY_SNAPSHOT;

const listeners = new Set<() => void>();

export function subscribeServerVersion(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function emit(): void {
  for (const l of listeners) l();
}

/** Invoke after every successful version GET so Settings (nocache) and polling stay in sync app-wide. */
export function publishServerVersion(data: SettingsVersionPayload): void {
  snapshot = {
    data,
    version: snapshot.version + 1,
  };
  emit();
}

/** Same object reference until the next publish (for useSyncExternalStore). */
export function getServerVersionSnapshotBox(): { data: SettingsVersionPayload | null; version: number } {
  return snapshot;
}

export function useServerVersionPayload(): SettingsVersionPayload | null {
  return useSyncExternalStore(
    subscribeServerVersion,
    () => getServerVersionSnapshotBox().data,
    () => getServerVersionSnapshotBox().data,
  );
}
