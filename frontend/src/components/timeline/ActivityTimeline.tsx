import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Keyboard,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layout,
  Moon,
  Bell,
  ImageIcon,
  Calendar,
} from "lucide-react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import Input from "@cloudscape-design/components/input";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import DateRangePicker, { type DateRangePickerProps } from "@cloudscape-design/components/date-range-picker";
import { Session, type SessionAlertEvent, formatDuration } from "../../lib/session-aggregator";
import { apiUrl } from "../../lib/api";
import { fmtDateTimePrecise, parseTimestamp } from "../../lib/utils";
import { AppIcon } from "../common/AppIcon";

interface ActivityTimelineProps {
  sessions: Session[];
  loading?: boolean;
  onRefresh?: () => void;
  /** ISO string timestamp — scroll to and highlight the nearest session */
  highlightTimestamp?: string | null;
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

function fmtTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local calendar day key for grouping (YYYY-MM-DD). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayHeading(dayKey: string): string {
  const [y, mo, da] = dayKey.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function sessionMatchesSearch(session: Session, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  const parts: string[] = [
    session.appName,
    session.appDisplayName,
    session.windowTitle,
    ...session.urls.map((u) => `${u.url} ${u.browser}`),
    ...session.windows.map((w) => w.window_title),
    ...session.keystrokes.map((k) => `${k.keys} ${k.window_title}`),
    ...(session.alertEvents ?? []).flatMap((e) => [e.rule_name, e.snippet, e.channel]),
  ];
  return parts.join(" ").toLowerCase().includes(n);
}

type DayGroup = {
  dayKey: string;
  label: string;
  items: { session: Session; idx: number }[];
};

function groupSessionsByDay(sessions: Session[]): DayGroup[] {
  const map = new Map<string, { session: Session; idx: number }[]>();
  sessions.forEach((session, idx) => {
    const key = dayKey(session.startTime);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ session, idx });
  });
  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((k) => ({
    dayKey: k,
    label: formatDayHeading(k),
    items: map.get(k)!,
  }));
}

const ACTIVITY_DATE_RELATIVE_OPTIONS: DateRangePickerProps.RelativeOption[] = [
  { key: "last-1-day", type: "relative", amount: 1, unit: "day" },
  { key: "last-7-days", type: "relative", amount: 7, unit: "day" },
  { key: "last-30-days", type: "relative", amount: 30, unit: "day" },
  { key: "last-1-week", type: "relative", amount: 1, unit: "week" },
];

const ACTIVITY_DATE_RANGE_I18N: DateRangePickerProps.I18nStrings = {
  modeSelectionLabel: "Range mode",
  relativeModeTitle: "Relative",
  absoluteModeTitle: "Absolute",
  relativeRangeSelectionHeading: "Presets",
  relativeRangeSelectionMonthlyDescription: "",
  cancelButtonLabel: "Cancel",
  clearButtonLabel: "Clear",
  applyButtonLabel: "Apply",
  formatRelativeRange: (v) => {
    if (v.key === "last-7-days") return "Last 7 days";
    if (v.key === "last-30-days") return "Last 30 days";
    if (v.key === "last-1-day") return "Today";
    if (v.key === "last-1-week") return "Last 1 week";
    if (v.unit === "day") return `Last ${v.amount} day${v.amount === 1 ? "" : "s"}`;
    if (v.unit === "week") return `Last ${v.amount} week${v.amount === 1 ? "" : "s"}`;
    if (v.unit === "month") return `Last ${v.amount} month${v.amount === 1 ? "" : "s"}`;
    if (v.unit === "year") return `Last ${v.amount} year${v.amount === 1 ? "" : "s"}`;
    return `${v.amount} ${v.unit}`;
  },
  formatUnit: (unit: DateRangePickerProps.TimeUnit, value: number) =>
    `${value} ${unit}${value === 1 ? "" : "s"}`,
  customRelativeRangeOptionLabel: "Custom",
  customRelativeRangeOptionDescription: "Set a custom duration",
  customRelativeRangeDurationLabel: "Duration",
  customRelativeRangeDurationPlaceholder: "0",
  customRelativeRangeUnitLabel: "Unit",
  startDateLabel: "Start date",
  startTimeLabel: "Start time",
  endDateLabel: "End date",
  endTimeLabel: "End time",
  dateConstraintText: "Use YYYY-MM-DD",
  monthConstraintText: "YYYY-MM",
  isoDatePlaceholder: "YYYY-MM-DD",
};

function parseISODateToLocalDay(dateIso: string): Date {
  const datePart = dateIso.split("T")[0] ?? dateIso;
  const parts = datePart.split("-").map((x) => parseInt(x, 10));
  if (parts.length < 3) return new Date(NaN);
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function resolveDateRangeToDayBounds(
  value: DateRangePickerProps.Value | null,
): { start: string; end: string } | null {
  if (!value) return null;
  if (value.type === "absolute") {
    const s = parseISODateToLocalDay(value.startDate);
    const e = parseISODateToLocalDay(value.endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const start = dayKey(s);
    const end = dayKey(e);
    return start <= end ? { start, end } : { start: end, end: start };
  }
  const now = new Date();
  const endDay = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { amount, unit } = value;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "day") {
    const startD = new Date(endDate);
    startD.setDate(endDate.getDate() - amount + 1);
    return { start: dayKey(startD), end: endDay };
  }
  if (unit === "week") {
    const startD = new Date(endDate);
    startD.setDate(endDate.getDate() - amount * 7 + 1);
    return { start: dayKey(startD), end: endDay };
  }
  if (unit === "month") {
    const startD = new Date(endDate);
    startD.setMonth(startD.getMonth() - amount);
    return { start: dayKey(startD), end: endDay };
  }
  if (unit === "year") {
    const startD = new Date(endDate);
    startD.setFullYear(startD.getFullYear() - amount);
    return { start: dayKey(startD), end: endDay };
  }
  let startMs = now.getTime();
  if (unit === "hour") startMs -= amount * 3600 * 1000;
  else if (unit === "minute") startMs -= amount * 60 * 1000;
  else if (unit === "second") startMs -= amount * 1000;
  else return null;
  const startD = new Date(startMs);
  const startDay = dayKey(new Date(startD.getFullYear(), startD.getMonth(), startD.getDate()));
  return { start: startDay, end: endDay };
}

function activityDateRangeIsValid(value: DateRangePickerProps.Value | null): DateRangePickerProps.ValidationResult {
  if (value == null) return { valid: true };
  if (value.type === "relative") {
    if (!Number.isFinite(value.amount) || value.amount <= 0) {
      return { valid: false, errorMessage: "Enter a positive amount" };
    }
    return { valid: true };
  }
  const a = parseISODateToLocalDay(value.startDate);
  const b = parseISODateToLocalDay(value.endDate);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) {
    return { valid: false, errorMessage: "Enter valid dates" };
  }
  if (a > b) return { valid: false, errorMessage: "Start date must be before end date" };
  return { valid: true };
}

function formatTimeRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const startStr = start.toLocaleTimeString([], opts);
  const endStr = end.toLocaleTimeString([], opts);
  if (!isSameDay(start, end)) {
    return `${fmtDate(start)} ${startStr} – ${fmtDate(end)} ${endStr}`;
  }
  return `${startStr} – ${endStr}`;
}

function mergeAlertEvents(
  a: Session["alertEvents"] | undefined,
  b: Session["alertEvents"] | undefined,
): Session["alertEvents"] {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length === 0 && bb.length === 0) return undefined;
  const seen = new Set<number>();
  const out: NonNullable<Session["alertEvents"]> = [];
  for (const ev of [...aa, ...bb]) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  out.sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime());
  return out;
}

// ── Merge adjacent sessions of same app ──────────────────────────────────────

function mergeAdjacentByApp(sessions: Session[]): Session[] {
  const out: Session[] = [];
  for (const s of sessions) {
    const last = out[out.length - 1];
    if (last && last.appName.toLowerCase() === s.appName.toLowerCase()) {
      out[out.length - 1] = {
        ...last,
        windowTitle: s.windowTitle || last.windowTitle,
        startTime: last.startTime < s.startTime ? last.startTime : s.startTime,
        endTime: last.endTime > s.endTime ? last.endTime : s.endTime,
        duration: Math.round(
          (Math.max(last.endTime.getTime(), s.endTime.getTime()) -
            Math.min(last.startTime.getTime(), s.startTime.getTime())) / 1000
        ),
        urls: [...last.urls, ...s.urls],
        keystrokes: [...last.keystrokes, ...s.keystrokes],
        windows: [...last.windows, ...s.windows],
        keystrokeCount: last.keystrokeCount + s.keystrokeCount,
        hasKeystrokes: last.hasKeystrokes || s.hasKeystrokes,
        hasUrls: last.hasUrls || s.hasUrls,
        alertEvents: mergeAlertEvents(last.alertEvents, s.alertEvents),
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

function dedupeWindowsByTimestampAndTitle(windows: Session["windows"]) {
  const seen = new Set<string>();
  const out: Session["windows"] = [];
  for (const win of windows) {
    const key = `${win.timestamp}::${win.window_title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(win);
  }
  return out;
}

/** Single chronological stream: window focus, URLs, and alert rows (incl. screenshots). */
type MergedActivityRow =
  | { kind: "window"; time: number; window: Session["windows"][number] }
  | { kind: "url"; time: number; url: Session["urls"][number] }
  | { kind: "page"; time: number; window: Session["windows"][number]; url: Session["urls"][number] }
  | { kind: "alert"; time: number; alert: SessionAlertEvent };

function timeMsFromUnknown(ts: string | undefined): number {
  const d = parseTimestamp(ts);
  return d ? d.getTime() : NaN;
}

function rowStableId(row: MergedActivityRow): number {
  if (row.kind === "window") return row.window.id;
  if (row.kind === "url") return row.url.id;
  if (row.kind === "page") return row.window.id * 1_000_000 + row.url.id;
  return row.alert.id;
}

/**
 * When window + URL share the same instant, treat as one navigation.
 * If several window rows share that instant with one URL, pair the **last** window (closest to URL)
 * with the URL; earlier windows stay as separate rows.
 */
function mergeWindowUrlAtSameInstant(rows: MergedActivityRow[]): MergedActivityRow[] {
  const out: MergedActivityRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const t = rows[i].time;
    let j = i;
    while (j < rows.length && rows[j].time === t) j++;
    const group = rows.slice(i, j);
    const urls = group.filter((r): r is Extract<MergedActivityRow, { kind: "url" }> => r.kind === "url");
    const wins = group.filter((r): r is Extract<MergedActivityRow, { kind: "window" }> => r.kind === "window");

    if (urls.length === 1 && wins.length >= 1) {
      const urlR = urls[0];
      const lastWin = wins[wins.length - 1];
      for (const r of group) {
        if (r.kind === "alert") out.push(r);
      }
      for (const w of wins.slice(0, -1)) {
        out.push(w);
      }
      out.push({
        kind: "page",
        time: t,
        window: lastWin.window,
        url: urlR.url,
      });
      i = j;
      continue;
    }
    for (const r of group) out.push(r);
    i = j;
  }
  return out;
}

/**
 * Windows, URLs, and alerts — **newest first** (matches the activity feed). Uses `parseTimestamp`
 * for sort keys. Same instant: alert → window → URL (inverse of bottom-up causal order), then id desc.
 */
function buildMergedActivityTimeline(session: Session): MergedActivityRow[] {
  const rows: MergedActivityRow[] = [];
  for (const w of session.windows) {
    const t = timeMsFromUnknown(w.timestamp);
    if (!isNaN(t)) rows.push({ kind: "window", time: t, window: w });
  }
  for (const u of session.urls) {
    const t = timeMsFromUnknown(u.timestamp);
    if (!isNaN(t)) rows.push({ kind: "url", time: t, url: u });
  }
  for (const ev of session.alertEvents ?? []) {
    const t = timeMsFromUnknown(ev.created_at);
    if (!isNaN(t)) rows.push({ kind: "alert", time: t, alert: ev });
  }
  rows.sort((a, b) => {
    if (a.time !== b.time) return b.time - a.time;
    const kindOrder: Record<MergedActivityRow["kind"], number> = {
      alert: 0,
      window: 1,
      url: 2,
      page: 1,
    };
    const kd = kindOrder[a.kind] - kindOrder[b.kind];
    if (kd !== 0) return kd;
    return rowStableId(b) - rowStableId(a);
  });
  return mergeWindowUrlAtSameInstant(rows);
}

function MergedActivityRowView({
  row,
  onOpenScreenshot,
}: {
  row: MergedActivityRow;
  onOpenScreenshot: (eventId: number) => void;
}) {
  if (row.kind === "window") {
    const win = row.window;
    return (
      <div className="vtl-merged-row vtl-merged-row--kind-window">
        <div className="vtl-merged-head">
          <span className="vtl-merged-time">{fmtDateTimePrecise(win.timestamp)}</span>
          <Badge color="grey">Window</Badge>
        </div>
        <div className="vtl-merged-body">
          <span className="vtl-merged-window-line">
            <Layout size={12} className="vtl-merged-icon" />
            <span title={win.window_title}>{win.window_title}</span>
          </span>
        </div>
      </div>
    );
  }

  if (row.kind === "page") {
    const { window: win, url: u } = row;
    return (
      <div className="vtl-merged-row vtl-merged-row--kind-page">
        <div className="vtl-merged-head">
          <span className="vtl-merged-time">{fmtDateTimePrecise(win.timestamp)}</span>
          <span title="Window title and URL captured at the same instant">
            <Badge color="blue">Page</Badge>
          </span>
        </div>
        <div className="vtl-merged-body">
          <span className="vtl-merged-window-line">
            <Layout size={12} className="vtl-merged-icon" />
            <span title={win.window_title}>{win.window_title}</span>
          </span>
          <a href={u.url} target="_blank" rel="noreferrer" className="vtl-merged-url-row">
            <ExternalLink size={10} className="vtl-url-icon" />
            <span className="vtl-url-text">{u.url.length > 120 ? u.url.slice(0, 120) + "…" : u.url}</span>
            {u.browser ? <span className="vtl-url-browser">{u.browser}</span> : null}
          </a>
        </div>
      </div>
    );
  }

  if (row.kind === "url") {
    const u = row.url;
    return (
      <div className="vtl-merged-row vtl-merged-row--kind-url">
        <div className="vtl-merged-head">
          <span className="vtl-merged-time">{fmtDateTimePrecise(u.timestamp)}</span>
          <Badge color="blue">URL</Badge>
        </div>
        <div className="vtl-merged-body">
          <a href={u.url} target="_blank" rel="noreferrer" className="vtl-merged-url-row">
            <ExternalLink size={10} className="vtl-url-icon" />
            <span className="vtl-url-text">
              {u.url.length > 120 ? u.url.slice(0, 120) + "…" : u.url}
            </span>
            {u.browser ? <span className="vtl-url-browser">{u.browser}</span> : null}
          </a>
        </div>
      </div>
    );
  }

  const ev = row.alert;
  const ruleName = (ev.rule_name || "—").trim() || "—";
  const triggerText = (ev.snippet || "").trim();
  const triggerLooksLikeUrl = /^https?:\/\//i.test(triggerText);
  return (
    <div className="vtl-merged-row vtl-merged-row--kind-alert">
      <div className="vtl-merged-head">
        <span className="vtl-merged-time">{fmtDateTimePrecise(ev.created_at)}</span>
        <Badge color="red">Alert</Badge>
        <Badge color={ev.channel === "url" ? "blue" : "grey"}>
          {ev.channel === "url" ? "URL" : ev.channel === "keys" ? "Keys" : ev.channel}
        </Badge>
      </div>
      <div className="vtl-merged-body">
        <div className="vtl-alert-detail">
          <div className="vtl-alert-detail-row">
            <div className="vtl-alert-detail-label">Rule</div>
            <div className="vtl-alert-detail-value vtl-alert-detail-value--rule">{ruleName}</div>
          </div>
          <div className="vtl-alert-detail-row">
            <div className="vtl-alert-detail-label">Trigger</div>
            <div className="vtl-alert-detail-value">
              {triggerText ? (
                triggerLooksLikeUrl ? (
                  <a
                    className="vtl-alert-trigger-link sentinel-monospace"
                    href={triggerText}
                    target="_blank"
                    rel="noreferrer"
                    title={triggerText}
                  >
                    {triggerText}
                  </a>
                ) : (
                  <span className="vtl-alert-trigger-text sentinel-monospace" title={triggerText}>
                    {triggerText}
                  </span>
                )
              ) : (
                <span className="vtl-alert-trigger-missing">—</span>
              )}
            </div>
          </div>
        </div>
        {ev.has_screenshot ? (
          <button
            type="button"
            className="vtl-alert-shot-btn"
            onClick={() => onOpenScreenshot(ev.id)}
            title="View full size"
          >
            <img
              src={apiUrl(`/alert-rule-events/${ev.id}/screenshot`)}
              alt=""
              className="vtl-alert-shot-thumb"
              loading="lazy"
            />
            <span className="vtl-alert-shot-hint">
              <ImageIcon size={12} /> Full size
            </span>
          </button>
        ) : ev.screenshot_requested ? (
          <p className="vtl-alert-shot-miss">
            Screenshot requested but not captured (may still be in progress).
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Session item ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  isLast,
  highlighted,
  forceExpanded,
  onOpenScreenshot,
  onFilterApp,
}: {
  session: Session;
  isLast: boolean;
  highlighted: boolean;
  forceExpanded: boolean;
  onOpenScreenshot: (eventId: number) => void;
  onFilterApp: (exeName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const isOpen = userToggled ? expanded : forceExpanded || expanded;

  const mergedTimeline = useMemo(() => buildMergedActivityTimeline(session), [session]);
  const alertCount = session.alertEvents?.length ?? 0;
  const canExpand = mergedTimeline.length > 0 || session.hasKeystrokes;
  const isIdle = session.appName === "__idle__";

  const accent = isIdle
    ? "var(--vtl-border)"
    : session.hasKeystrokes
    ? session.hasUrls
      ? "var(--vtl-accent)"
      : "var(--vtl-success)"
    : session.hasUrls
    ? "var(--vtl-accent)"
    : "var(--vtl-border)";

  const highlightStyle: React.CSSProperties = highlighted
    ? {
        outline: "2px solid var(--vtl-accent)",
        outlineOffset: 2,
        borderRadius: 8,
        boxShadow: "0 0 0 6px rgba(100,160,255,0.18)",
        animation: "vtl-highlight-pulse 1.8s ease 2",
      }
    : {};

  return (
    <div className="vtl-item">
      {/* Left: timestamp */}
      <div className="vtl-timestamp">
        <span className="vtl-time">{fmtTime(session.startTime)}</span>
        <span className="vtl-dur">{formatDuration(session.duration)}</span>
        {highlighted && (
          <span className="vtl-alert-pin" title="Notification fired near this time">
            <Bell size={10} />
          </span>
        )}
      </div>

      {/* Center: dot + line */}
      <div className="vtl-spine">
        <div
          className="vtl-dot"
          style={{
            borderColor: highlighted ? "var(--vtl-accent)" : accent,
            boxShadow: highlighted
              ? "0 0 0 4px rgba(100,160,255,0.25)"
              : `0 0 0 3px ${accent}22`,
            opacity: isIdle ? 0.55 : 1,
            transform: highlighted ? "scale(1.3)" : undefined,
          }}
        />
        {!isLast && <div className="vtl-rail" />}
      </div>

      {/* Right: card */}
      <div
        className={`vtl-card${isIdle && !isOpen ? " vtl-card--idle-compact" : ""}`}
        style={highlightStyle}
      >
        <button
          className="vtl-card-header"
          onClick={() => {
            if (canExpand) {
              setUserToggled(true);
              setExpanded((v) => !v);
            }
          }}
          style={{ cursor: canExpand ? "pointer" : "default" }}
          aria-expanded={isOpen}
        >
          <div className="vtl-card-main">
            <div className="vtl-card-title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {isIdle && <Moon size={14} />}
              {!isIdle ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (session.appName) onFilterApp(session.appName);
                  }}
                  title="Filter timeline by this app"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--vtl-border)",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {session.agentId ? <AppIcon agentId={session.agentId} exeName={session.appName} size={16} /> : null}
                  <span>{session.appDisplayName || session.appName}</span>
                </button>
              ) : (
                <span>Idle / Away</span>
              )}
              {highlighted && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    color: "var(--vtl-accent)",
                    fontSize: 11,
                  }}
                >
                  <Bell size={11} /> Alert fired
                </span>
              )}
            </div>
            {!isIdle && (
              <div style={{ fontSize: "12px", opacity: 0.8 }} className="sentinel-monospace">
                {session.appName}
              </div>
            )}
            {!isIdle && session.windowTitle && session.windowTitle !== session.appName && (
              <div className="vtl-card-subtitle">{session.windowTitle}</div>
            )}
            {isIdle && (
              <div className="vtl-card-subtitle" style={{ opacity: 0.75 }}>
                No activity detected
              </div>
            )}
            <div className="vtl-card-meta">
              <span className="vtl-meta-time">{formatTimeRange(session.startTime, session.endTime)}</span>
              {session.hasKeystrokes && (
                <span className="vtl-pill vtl-pill-keys">
                  <Keyboard size={9} />
                  {session.keystrokeCount} keys
                </span>
              )}
              {session.hasUrls && (
                <span className="vtl-pill vtl-pill-urls">
                  <Globe size={9} />
                  {session.urls.length} URLs
                </span>
              )}
              {alertCount > 0 && (
                <span className="vtl-pill vtl-pill-alert">
                  <Bell size={9} />
                  {alertCount === 1 ? "Alert" : `${alertCount} alerts`}
                </span>
              )}
            </div>
          </div>
          {canExpand && (
            <span className="vtl-chevron">
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="vtl-card-body">
            {mergedTimeline.length > 0 && (
              <div className="vtl-section">
                <p className="vtl-section-label">Timeline ({mergedTimeline.length})</p>
                <div className="vtl-merged-timeline">
                  {mergedTimeline.map((row, i) => (
                    <MergedActivityRowView
                      key={`${row.kind}-${
                        row.kind === "window"
                          ? row.window.id
                          : row.kind === "url"
                            ? row.url.id
                            : row.kind === "page"
                              ? `${row.window.id}-${row.url.id}`
                              : row.alert.id
                      }-${i}`}
                      row={row}
                      onOpenScreenshot={onOpenScreenshot}
                    />
                  ))}
                </div>
              </div>
            )}

            {session.hasKeystrokes && (
              <div className="vtl-section">
                <p className="vtl-section-label">Keystrokes ({session.keystrokes.length} sessions)</p>
                <div className="vtl-key-list">
                  {session.keystrokes.slice(0, 3).map((ks, i) => (
                    <code key={i} className="vtl-key-block">
                      {ks.keys.slice(0, 80)}
                      {ks.keys.length > 80 ? "…" : ""}
                    </code>
                  ))}
                  {session.keystrokes.length > 3 && (
                    <p className="vtl-more">…and {session.keystrokes.length - 3} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineScreenshotModal({
  eventId,
  onClose,
}: {
  eventId: number | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={eventId != null}
      onDismiss={onClose}
      closeAriaLabel="Close screenshot"
      header="Alert screenshot"
      size="max"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {eventId != null && (
              <Button
                href={apiUrl(`/alert-rule-events/${eventId}/screenshot`)}
                target="_blank"
                iconName="external"
              >
                Open in new tab
              </Button>
            )}
            <Button variant="link" onClick={onClose}>
              Close
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {eventId != null ? (
        <div style={{ textAlign: "center" }}>
          <img
            src={apiUrl(`/alert-rule-events/${eventId}/screenshot`)}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "72vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        </div>
      ) : null}
    </Modal>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityTimeline({ sessions, loading, onRefresh, highlightTimestamp }: ActivityTimelineProps) {
  const [screenshotModalId, setScreenshotModalId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [appFilterExe, setAppFilterExe] = useState<string | null>(null);
  const [jumpRangeValue, setJumpRangeValue] = useState<DateRangePickerProps.Value | null>(null);
  /** Explicit expand/collapse per day; omitted keys use default (newest day expanded only). */
  const [dayExpanded, setDayExpanded] = useState<Record<string, boolean>>({});

  const sorted = useMemo(
    () =>
      mergeAdjacentByApp([...sessions].reverse()).map((s) => ({
        ...s,
        windows: dedupeWindowsByTimestampAndTitle(s.windows),
      })),
    [sessions],
  );

  const jumpRangeBounds = useMemo(() => resolveDateRangeToDayBounds(jumpRangeValue), [jumpRangeValue]);

  /** Deferred so typing in search does not re-filter a huge list on every keystroke. */
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredSorted = useMemo(() => {
    let xs = sorted;
    if (alertsOnly) xs = xs.filter((s) => (s.alertEvents?.length ?? 0) > 0);
    if (appFilterExe) {
      const key = appFilterExe.toLowerCase();
      xs = xs.filter((s) => (s.appName || "").toLowerCase() === key);
    }
    if (deferredSearchQuery.trim()) {
      xs = xs.filter((s) => sessionMatchesSearch(s, deferredSearchQuery));
    }
    if (jumpRangeBounds) {
      xs = xs.filter((s) => {
        const k = dayKey(s.startTime);
        return k >= jumpRangeBounds.start && k <= jumpRangeBounds.end;
      });
    }
    return xs;
  }, [sorted, alertsOnly, appFilterExe, deferredSearchQuery, jumpRangeBounds]);

  const dayGroups = useMemo(() => groupSessionsByDay(filteredSorted), [filteredSorted]);

  const scrollAfterDateApply = useRef(false);
  const onJumpRangeChange = useCallback((event: { detail: DateRangePickerProps.ChangeDetail }) => {
    setJumpRangeValue(event.detail.value);
    if (event.detail.value) scrollAfterDateApply.current = true;
  }, []);

  useEffect(() => {
    if (!scrollAfterDateApply.current) return;
    scrollAfterDateApply.current = false;
    const dk = dayGroups[0]?.dayKey;
    if (!dk) return;
    setDayExpanded((prev) => ({ ...prev, [dk]: true }));
    window.setTimeout(() => {
      document.getElementById(`vtl-day-${dk}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [jumpRangeValue, dayGroups]);

  const firstDayKey = dayGroups[0]?.dayKey ?? "";

  const isDayExpanded = useCallback(
    (key: string) => {
      if (key in dayExpanded) return dayExpanded[key]!;
      return key === firstDayKey;
    },
    [dayExpanded, firstDayKey],
  );

  const toggleDay = useCallback((key: string) => {
    setDayExpanded((prev) => {
      const current = key in prev ? prev[key]! : key === firstDayKey;
      return { ...prev, [key]: !current };
    });
  }, [firstDayKey]);

  const expandAllDays = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const g of dayGroups) next[g.dayKey] = true;
    setDayExpanded(next);
  }, [dayGroups]);

  const collapseAllDays = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const g of dayGroups) next[g.dayKey] = false;
    setDayExpanded(next);
  }, [dayGroups]);

  const anyDayExpanded = useMemo(() => {
    if (dayGroups.length === 0) return false;
    return dayGroups.some((g) => {
      if (g.dayKey in dayExpanded) return dayExpanded[g.dayKey]!;
      // Default behavior: newest day expanded only.
      return g.dayKey === firstDayKey;
    });
  }, [dayGroups, dayExpanded, firstDayKey]);

  // Find the index of the session closest to the highlight timestamp (within filtered list)
  const highlightIndex = useMemo(() => {
    if (!highlightTimestamp || filteredSorted.length === 0) return -1;
    const targetMs = new Date(highlightTimestamp).getTime();
    if (isNaN(targetMs)) return -1;
    let best = 0;
    let bestDist = Infinity;
    filteredSorted.forEach((s, i) => {
      const start = s.startTime.getTime();
      const end = s.endTime.getTime();
      const dist = targetMs < start ? start - targetMs : targetMs > end ? targetMs - end : 0;
      const isIdle = s.appName === "__idle__";
      const bestIdle = filteredSorted[best].appName === "__idle__";
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      } else if (dist === bestDist) {
        if (bestIdle && !isIdle) best = i;
      }
    });
    return best;
  }, [filteredSorted, highlightTimestamp]);

  // Open the day that contains the highlighted session (e.g. deep link from alerts)
  useEffect(() => {
    if (highlightIndex < 0 || !filteredSorted[highlightIndex]) return;
    const dk = dayKey(filteredSorted[highlightIndex].startTime);
    setDayExpanded((prev) => ({ ...prev, [dk]: true }));
  }, [highlightIndex, highlightTimestamp, filteredSorted]);

  const itemDivRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const setRef = useCallback((idx: number) => (el: HTMLDivElement | null) => {
    if (el) itemDivRefs.current.set(idx, el);
    else itemDivRefs.current.delete(idx);
  }, []);

  const lastScrolledTimestamp = useRef<string | null>(null);
  useEffect(() => {
    if (highlightIndex < 0 || !highlightTimestamp) return;
    if (lastScrolledTimestamp.current === highlightTimestamp) return;
    lastScrolledTimestamp.current = highlightTimestamp;

    const timer = setTimeout(() => {
      const el = itemDivRefs.current.get(highlightIndex);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightIndex, highlightTimestamp]);

  const keystrokeCount = sorted.filter((s) => s.hasKeystrokes).length;
  const urlCount = sorted.filter((s) => s.hasUrls).length;
  const alertFireCount = useMemo(
    () => sorted.reduce((n, s) => n + (s.alertEvents?.length ?? 0), 0),
    [sorted],
  );

  const isFiltered = searchQuery.trim().length > 0 || alertsOnly || jumpRangeValue != null;
  const headerDesc = useMemo(() => {
    const base = isFiltered
      ? `${filteredSorted.length} of ${sorted.length} sessions`
      : `${sorted.length} sessions`;
    return `${base} tracked${highlightTimestamp ? " · scrolled to alert time" : ""}`;
  }, [filteredSorted.length, sorted.length, isFiltered, highlightTimestamp, jumpRangeValue]);

  if (loading && sessions.length === 0) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
        </Box>
      </Container>
    );
  }

  if (sessions.length === 0) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="p" color="text-body-secondary">
            No activity data recorded yet.
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <>
      <Container
        header={
          <Header
            variant="h2"
            description={headerDesc}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {onRefresh && (
                  <Button iconName="refresh" onClick={onRefresh} loading={loading}>
                    Refresh
                  </Button>
                )}
                {alertFireCount > 0 && (
                  <Badge color="red">
                    {alertFireCount} alert{alertFireCount === 1 ? "" : "s"}
                  </Badge>
                )}
                {keystrokeCount > 0 && (
                  <Badge color="green">{keystrokeCount} with keystrokes</Badge>
                )}
                {urlCount > 0 && (
                  <Badge color="blue">{urlCount} with URLs</Badge>
                )}
              </SpaceBetween>
            }
          >
            Activity Timeline
          </Header>
        }
      >
        <div className="vtl-root">
          <div className="vtl-toolbar">
            <FormField label="Search activity" stretch>
              <div className="vtl-toolbar-search">
                <Input
                  value={searchQuery}
                  onChange={({ detail }) => setSearchQuery(detail.value)}
                  placeholder="App, URL, window title, keystrokes, alert rule…"
                  type="search"
                />
              </div>
            </FormField>
            <FormField label="Date range">
              <div className="vtl-toolbar-jump">
                <DateRangePicker
                  value={jumpRangeValue}
                  onChange={onJumpRangeChange}
                  relativeOptions={ACTIVITY_DATE_RELATIVE_OPTIONS}
                  isValidRange={activityDateRangeIsValid}
                  dateOnly
                  i18nStrings={ACTIVITY_DATE_RANGE_I18N}
                  placeholder="All days"
                  showClearButton
                  expandToViewport
                  granularity="day"
                  ariaLabel="Filter activity by calendar date range"
                />
              </div>
            </FormField>
            <Button
              variant="link"
              onClick={() => (anyDayExpanded ? collapseAllDays() : expandAllDays())}
            >
              {anyDayExpanded ? "Collapse all days" : "Expand all days"}
            </Button>
            <div className="vtl-toolbar-alerts">
              <Checkbox
                checked={alertsOnly}
                onChange={({ detail }) => setAlertsOnly(detail.checked)}
              >
                Alerts only
              </Checkbox>
            </div>
            {appFilterExe ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
                <Badge color="blue">App: {appFilterExe}</Badge>
                <Button variant="link" onClick={() => setAppFilterExe(null)}>
                  Clear
                </Button>
              </div>
            ) : null}
          </div>

          {filteredSorted.length === 0 ? (
            <Box padding={{ vertical: "l" }} textAlign="center" color="text-body-secondary">
              No sessions match your filters. Clear search, date range, or turn off &quot;Alerts only&quot;.
            </Box>
          ) : (
            <div className="vtl-list">
              {dayGroups.map((group) => {
                const expanded = isDayExpanded(group.dayKey);
                return (
                  <div key={group.dayKey} id={`vtl-day-${group.dayKey}`} className="vtl-day-block">
                    <button
                      type="button"
                      className="vtl-day-header"
                      onClick={() => toggleDay(group.dayKey)}
                      aria-expanded={expanded}
                    >
                      <ChevronRight
                        size={16}
                        className={`vtl-day-chevron ${expanded ? "vtl-day-chevron--open" : ""}`}
                        aria-hidden
                      />
                      <Calendar size={15} style={{ opacity: 0.85 }} aria-hidden />
                      <span className="vtl-day-header-label">{group.label}</span>
                      <span className="vtl-day-header-cta">
                        {group.items.length} session{group.items.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    {expanded && (
                      <div className="vtl-day-body">
                        {group.items.map(({ session, idx }) => {
                          const isHighlighted = idx === highlightIndex && highlightTimestamp != null;
                          return (
                            <div key={session.id} ref={isHighlighted ? setRef(idx) : undefined}>
                              <SessionItem
                                session={session}
                                isLast={idx === filteredSorted.length - 1}
                                highlighted={isHighlighted}
                                forceExpanded={isHighlighted}
                                onOpenScreenshot={setScreenshotModalId}
                                onFilterApp={(exe) =>
                                  setAppFilterExe((prev) =>
                                    prev?.toLowerCase() === exe.toLowerCase() ? null : exe
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Container>
      <TimelineScreenshotModal
        eventId={screenshotModalId}
        onClose={() => setScreenshotModalId(null)}
      />
    </>
  );
}
