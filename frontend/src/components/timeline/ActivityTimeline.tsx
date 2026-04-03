import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Keyboard,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layout,
  Moon,
  Bell,
} from "lucide-react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import Button from "@cloudscape-design/components/button";
import { Session, formatDuration } from "../../lib/session-aggregator";

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

function formatTimeRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const startStr = start.toLocaleTimeString([], opts);
  const endStr = end.toLocaleTimeString([], opts);
  if (!isSameDay(start, end)) {
    return `${fmtDate(start)} ${startStr} – ${fmtDate(end)} ${endStr}`;
  }
  return `${startStr} – ${endStr}`;
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

// ── Day separator ─────────────────────────────────────────────────────────────

function DaySeparator({ date }: { date: Date }) {
  return (
    <div className="vtl-day-sep">
      <span className="vtl-day-label">
        {date.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </span>
    </div>
  );
}

// ── Session item ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  isLast,
  highlighted,
  forceExpanded,
}: {
  session: Session;
  isLast: boolean;
  highlighted: boolean;
  forceExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const isOpen = userToggled ? expanded : forceExpanded || expanded;

  const canExpand = session.windows.length > 0 || session.hasKeystrokes || session.hasUrls;
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
      <div className="vtl-card" style={highlightStyle}>
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
              <span>{isIdle ? "Idle / Away" : session.appDisplayName || session.appName}</span>
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
            {session.hasUrls && (
              <div className="vtl-section">
                <p className="vtl-section-label">URLs visited ({session.urls.length})</p>
                <div className="vtl-url-list">
                  {session.urls.slice(0, 6).map((u, i) => (
                    <a
                      key={i}
                      href={u.url}
                      target="_blank"
                      rel="noreferrer"
                      className="vtl-url-row"
                      title={u.url}
                    >
                      <ExternalLink size={10} className="vtl-url-icon" />
                      <span className="vtl-url-text">
                        {u.url.length > 80 ? u.url.slice(0, 80) + "…" : u.url}
                      </span>
                      {u.browser && <span className="vtl-url-browser">{u.browser}</span>}
                    </a>
                  ))}
                  {session.urls.length > 6 && (
                    <p className="vtl-more">…and {session.urls.length - 6} more</p>
                  )}
                </div>
              </div>
            )}

            {session.windows.length > 0 && (
              <div className="vtl-section">
                <p className="vtl-section-label">Window titles ({session.windows.length})</p>
                <div className="vtl-window-list">
                  {[...session.windows]
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .map((win, i) => (
                      <div key={`${win.id}-${i}`} className="vtl-window-row">
                        <Layout size={10} className="vtl-window-icon" />
                        <span className="vtl-window-time">
                          {new Date(win.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span className="vtl-window-title" title={win.window_title}>
                          {win.window_title}
                        </span>
                      </div>
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

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityTimeline({ sessions, loading, onRefresh, highlightTimestamp }: ActivityTimelineProps) {
  const sorted = useMemo(
    () =>
      mergeAdjacentByApp([...sessions].reverse()).map((s) => ({
        ...s,
        windows: dedupeWindowsByTimestampAndTitle(s.windows),
      })),
    [sessions]
  );

  // Find the index of the session closest to the highlight timestamp
  const highlightIndex = useMemo(() => {
    if (!highlightTimestamp || sorted.length === 0) return -1;
    const targetMs = new Date(highlightTimestamp).getTime();
    if (isNaN(targetMs)) return -1;
    let best = 0;
    let bestDist = Infinity;
    sorted.forEach((s, i) => {
      const start = s.startTime.getTime();
      const end = s.endTime.getTime();
      const dist = targetMs < start ? start - targetMs : targetMs > end ? targetMs - end : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }, [sorted, highlightTimestamp]);

  // Map from index → DOM element for scrolling
  const itemDivRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const setRef = useCallback((idx: number) => (el: HTMLDivElement | null) => {
    if (el) itemDivRefs.current.set(idx, el);
    else itemDivRefs.current.delete(idx);
  }, []);

  // Scroll to highlighted item when it changes
  const lastScrolledTimestamp = useRef<string | null>(null);
  useEffect(() => {
    if (highlightIndex < 0 || !highlightTimestamp) return;
    if (lastScrolledTimestamp.current === highlightTimestamp) return;
    lastScrolledTimestamp.current = highlightTimestamp;

    const timer = setTimeout(() => {
      const el = itemDivRefs.current.get(highlightIndex);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightIndex, highlightTimestamp]);

  const keystrokeCount = sorted.filter((s) => s.hasKeystrokes).length;
  const urlCount = sorted.filter((s) => s.hasUrls).length;

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
    <Container
      header={
        <Header
          variant="h2"
          description={`${sorted.length} sessions tracked${highlightTimestamp ? " · scrolled to alert time" : ""}`}
          actions={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              {onRefresh && (
                <Button iconName="refresh" onClick={onRefresh} loading={loading}>
                  Refresh
                </Button>
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
        <div className="vtl-list">
          {sorted.map((session, idx) => {
            const prevSession = sorted[idx - 1];
            const showDaySep = !prevSession || !isSameDay(prevSession.startTime, session.startTime);
            const isHighlighted = idx === highlightIndex && highlightTimestamp != null;
            return (
              <div key={session.id} ref={isHighlighted ? setRef(idx) : undefined}>
                {showDaySep && <DaySeparator date={session.startTime} />}
                <SessionItem
                  session={session}
                  isLast={idx === sorted.length - 1}
                  highlighted={isHighlighted}
                  forceExpanded={isHighlighted}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Container>
  );
}
