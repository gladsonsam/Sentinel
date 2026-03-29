import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class strings safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeTimestampInput(ts: string | number): string | number {
  if (typeof ts === "number") return ts;
  const trimmed = ts.trim();
  if (!trimmed) return trimmed;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return trimmed.length > 10 ? Math.floor(numeric / 1000) : numeric;
    }
  }
  return trimmed;
}

export function parseTimestamp(ts: string | number | undefined): Date | null {
  if (ts === undefined || ts === null) return null;
  const normalized = normalizeTimestampInput(ts);
  const date =
    typeof normalized === "number" ? new Date(normalized * 1000) : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format an ISO string or unix-seconds timestamp to a short time string. */
export function fmtTime(ts: string | number | undefined): string {
  const d = parseTimestamp(ts);
  return d ? d.toLocaleTimeString() : "—";
}

/** Format an ISO string or unix-seconds timestamp to a full date-time string. */
export function fmtDateTime(ts: string | number | undefined): string {
  const d = parseTimestamp(ts);
  return d ? d.toLocaleString() : "—";
}

/** Truncate a string to `maxLen` characters, appending '…' if truncated. */
export function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

/** Copy text to clipboard and return true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
