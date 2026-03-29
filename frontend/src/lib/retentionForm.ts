/** Shared helpers for retention day fields (server: null = no auto-delete). */

export function daysToField(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

export function parseRetentionField(s: string): {
  value: number | null;
  error: string | null;
} {
  try {
    return { value: fieldToDays(s), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Blank → use default / no limit. Whole days 1–36500. */
export function fieldToDays(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) {
    throw new Error("Enter a whole number of days, or leave the field blank.");
  }
  const n = parseInt(t, 10);
  if (n < 1 || n > 36500) {
    throw new Error("Use a number between 1 and 36500, or leave blank.");
  }
  return n;
}

/** Short label for read-only summaries. */
export function fmtRetentionBrief(d: number | null | undefined): string {
  if (d == null) return "no auto-delete";
  return `${d} days`;
}

export const RETENTION_INPUT_CLASS =
  "w-full max-w-xs bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent transition-colors";
