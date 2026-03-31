import { useMemo, useState } from "react";
import {
  Globe,
  Keyboard,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layout,
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
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimeRange(start: Date, end: Date): string {
  return `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} – ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

/** Merge consecutive sessions that share the same executable name. */
function mergeAdjacentByApp(sessions: Session[]): Session[] {
  const out: Session[] = [];
  for (const s of sessions) {
    const last = out[out.length - 1];
    if (
      last &&
      last.appName.toLowerCase() === s.appName.toLowerCase()
    ) {
      // Extend the merged session
      out[out.length - 1] = {
        ...last,
        // Keep the latest window title
        windowTitle: s.windowTitle || last.windowTitle,
        // Span the full time range
        startTime: last.startTime < s.startTime ? last.startTime : s.startTime,
        endTime: last.endTime > s.endTime ? last.endTime : s.endTime,
        duration: Math.round(
          (Math.max(last.endTime.getTime(), s.endTime.getTime()) -
            Math.min(last.startTime.getTime(), s.startTime.getTime())) / 1000
        ),
        // Combine data arrays
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


function SessionItem({ session, isLast }: { session: Session; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = session.windows.length > 0 || session.hasKeystrokes || session.hasUrls;

  const accent = session.hasKeystrokes && session.hasUrls
    ? "#5b8def"
    : session.hasUrls
    ? "#5b8def"
    : session.hasKeystrokes
    ? "#4caf78"
    : "#3a3d4d";

  return (
    <div className="vtl-item">
      {/* Left: timestamp */}
      <div className="vtl-timestamp">
        <span className="vtl-time">{fmtTime(session.startTime)}</span>
        <span className="vtl-dur">{formatDuration(session.duration)}</span>
      </div>

      {/* Center: dot + line */}
      <div className="vtl-spine">
        <div className="vtl-dot" style={{ borderColor: accent, boxShadow: `0 0 0 3px ${accent}22` }} />
        {!isLast && <div className="vtl-rail" />}
      </div>

      {/* Right: card */}
      <div className="vtl-card">
        <button
          className="vtl-card-header"
          onClick={() => canExpand && setExpanded((v) => !v)}
          style={{ cursor: canExpand ? "pointer" : "default" }}
          aria-expanded={expanded}
        >
          <div className="vtl-card-main">
            <div className="vtl-card-title">{session.appName}</div>
            {session.windowTitle && session.windowTitle !== session.appName && (
              <div className="vtl-card-subtitle">{session.windowTitle}</div>
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
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          )}
        </button>

        {expanded && (
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
                    .sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                    )
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
                      {ks.keys.slice(0, 80)}{ks.keys.length > 80 ? "…" : ""}
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

export function ActivityTimeline({ sessions, loading, onRefresh }: ActivityTimelineProps) {
  const sorted = useMemo(
    () =>
      mergeAdjacentByApp([...sessions].reverse()).map((s) => ({
        ...s,
        windows: dedupeWindowsByTimestampAndTitle(s.windows),
      })),
    [sessions]
  );

  const keystrokeCount = sorted.filter((s) => s.hasKeystrokes).length;
  const urlCount = sorted.filter((s) => s.hasUrls).length;

  // Avoid flicker during background refresh: only show the big loading state
  // when we have no data yet.
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
          description={`${sorted.length} sessions tracked`}
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

      {/* Timeline list */}
      <div className="vtl-list">
        {sorted.map((session, idx) => (
          <SessionItem
            key={session.id}
            session={session}
            isLast={idx === sorted.length - 1}
          />
        ))}
      </div>
      </div>
    </Container>
  );
}
