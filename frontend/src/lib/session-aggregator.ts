// Session aggregator for timeline visualization
// Combines windows, URLs, and keystrokes into logical sessions

interface WindowEvent {
  id: number;
  window_title: string;
  exe_name: string;
  app_display?: string;
  timestamp: string;
}

interface URLEvent {
  id: number;
  url: string;
  browser: string;
  timestamp: string;
}

interface KeystrokeEvent {
  id: number;
  window_title: string;
  exe_name: string;
  app_display?: string;
  keys: string;
  timestamp: string;
}

export interface Session {
  id: string;
  appName: string;
  appDisplayName: string;
  windowTitle: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  keystrokeCount: number;
  urls: URLEvent[];
  keystrokes: KeystrokeEvent[];
  windows: WindowEvent[];
  hasKeystrokes: boolean;
  hasUrls: boolean;
}

interface AggregateSessionsOptions {
  windows: WindowEvent[];
  urls: URLEvent[];
  keystrokes: KeystrokeEvent[];
  gapThresholdSeconds?: number;
}

function normalizeSpace(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function isGenericWindowsOsName(name: string): boolean {
  const n = normalizeSpace(name).toLowerCase();
  return (
    n === "microsoft windows operating system" ||
    n === "microsoft® windows® operating system" ||
    n.includes("windows operating system")
  );
}

function lastTitleSegment(title: string): string {
  // Common pattern: "something - AppName"
  const t = normalizeSpace(title);
  const idx = t.lastIndexOf(" - ");
  if (idx >= 0) return t.slice(idx + 3).trim();
  return t;
}

function deriveAppDisplayName(window: WindowEvent): string {
  const exe = normalizeSpace(window.exe_name).toLowerCase();
  const title = normalizeSpace(window.window_title);
  const titleTail = lastTitleSegment(title);
  const meta = normalizeSpace(window.app_display);

  // UWP/packaged apps often run under a host process like ApplicationFrameHost.
  // In that case the window title is the "real" app name (e.g. "Calculator").
  if (exe === "applicationframehost.exe") {
    if (titleTail) return titleTail;
    if (title) return title;
  }

  // Explorer's version metadata is frequently generic; the UI should call it File Explorer.
  if (exe === "explorer.exe") {
    if (titleTail.toLowerCase() === "file explorer") return "File Explorer";
    if (title.toLowerCase().includes("file explorer")) return "File Explorer";
    if (meta && !isGenericWindowsOsName(meta)) return meta;
    return "File Explorer";
  }

  // If metadata is a generic OS name, prefer the (often meaningful) window title.
  if (meta && isGenericWindowsOsName(meta)) {
    if (titleTail) return titleTail;
    if (title) return title;
    return window.exe_name;
  }

  return meta || window.exe_name;
}

/**
 * Known browser executable names (lower-case).
 * URLs captured by the agent should only ever be attributed to one of these.
 */
const BROWSER_EXES = new Set([
  "chrome.exe",
  "chromium.exe",
  "firefox.exe",
  "msedge.exe",
  "helium.exe",
  "brave.exe",
  "opera.exe",
  "vivaldi.exe",
  "iexplore.exe",
  "waterfox.exe",
  "librewolf.exe",
  "thorium.exe",
  "arc.exe",
  "safari.exe",
  "min.exe",
]);

function isBrowser(appName: string): boolean {
  return BROWSER_EXES.has(appName.toLowerCase());
}

/**
 * Redistribute all URLs so they only appear in browser sessions.
 *
 * Strategy (in order of preference for each URL):
 *  1. The browser session whose time range contains the URL's timestamp.
 *  2. The browser session closest in time (by distance to its [start, end] interval).
 *
 * If there are no browser sessions at all the URLs stay where the
 * time-range pass already put them (graceful fallback).
 */
function redistributeUrlsToBrowserSessions(
  sessions: Session[],
  allUrls: URLEvent[],
  gapMs: number,
): void {
  const browserSessions = sessions.filter((s) => isBrowser(s.appName));
  if (browserSessions.length === 0) return;

  // Clear URLs from every session — we'll re-assign from scratch.
  for (const s of sessions) {
    s.urls = [];
    s.hasUrls = false;
  }

  for (const url of allUrls) {
    const urlMs = new Date(url.timestamp).getTime();

    // 1. Find a browser session whose range brackets this URL.
    const containing = browserSessions.find((s) => {
      const startMs = s.startTime.getTime();
      const endMs = s.endTime.getTime();
      return urlMs >= startMs && urlMs <= endMs + gapMs;
    });

    if (containing) {
      containing.urls.push(url);
      continue;
    }

    // 2. Fall back to the nearest browser session by interval distance.
    let nearest = browserSessions[0];
    let nearestDist = Infinity;
    for (const s of browserSessions) {
      const startMs = s.startTime.getTime();
      const endMs = s.endTime.getTime();
      // Distance = 0 if inside the interval, otherwise gap to nearest edge.
      const dist =
        urlMs < startMs ? startMs - urlMs : urlMs > endMs ? urlMs - endMs : 0;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = s;
      }
    }
    nearest.urls.push(url);
  }

  // Recompute hasUrls flag.
  for (const s of sessions) {
    s.hasUrls = s.urls.length > 0;
  }
}

export function aggregateSessions({
  windows,
  urls,
  keystrokes,
  gapThresholdSeconds = 300,
}: AggregateSessionsOptions): Session[] {
  if (windows.length === 0) return [];

  const sessions: Session[] = [];
  let currentSession: Session | null = null;

  const sortedWindows = [...windows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const window of sortedWindows) {
    const windowTime = new Date(window.timestamp);
    const prevEndMs = currentSession?.endTime.getTime();

    // The *previous* foreground state lasts until this window event occurs.
    // Without this, durations collapse to ~0s because events are instantaneous.
    if (currentSession) {
      currentSession.endTime = windowTime;
    }

    const shouldStartNew =
      !currentSession ||
      currentSession.appName !== window.exe_name ||
      (typeof prevEndMs === "number" &&
        (windowTime.getTime() - prevEndMs) / 1000 > gapThresholdSeconds);

    if (shouldStartNew) {
      if (currentSession) {
        sessions.push(currentSession);
      }

      currentSession = {
        id: `session-${window.id}-${windowTime.getTime()}`,
        appName: window.exe_name,
        appDisplayName: deriveAppDisplayName(window),
        windowTitle: window.window_title,
        startTime: windowTime,
        endTime: windowTime,
        duration: 0,
        keystrokeCount: 0,
        urls: [],
        keystrokes: [],
        windows: [window],
        hasKeystrokes: false,
        hasUrls: false,
      };
    } else if (currentSession) {
      currentSession.windowTitle = window.window_title;
      // Some executables host multiple "real" apps (e.g. ApplicationFrameHost.exe).
      // Keep the display name aligned with the most recent foreground title.
      currentSession.appDisplayName = deriveAppDisplayName(window);
      currentSession.windows.push(window);
    }
  }

  if (currentSession) {
    sessions.push(currentSession);
  }

  const gapMs = gapThresholdSeconds * 1000;

  // Extend the last session so the timeline is continuous up to "now"
  // when the data appears to be from the current/ongoing recording.
  const last = sessions[sessions.length - 1];
  if (last) {
    const maxEventMs = Math.max(
      ...sortedWindows.map((w) => new Date(w.timestamp).getTime()),
      ...(urls.length ? urls.map((u) => new Date(u.timestamp).getTime()) : [0]),
      ...(keystrokes.length
        ? keystrokes.map((k) => new Date(k.timestamp).getTime())
        : [0])
    );
    const nowMs = Date.now();
    const endMs = nowMs - maxEventMs <= gapMs ? nowMs : maxEventMs;
    if (endMs > last.endTime.getTime()) {
      last.endTime = new Date(endMs);
    }
  }

  for (const session of sessions) {
    const startMs = session.startTime.getTime();
    const endMs = session.endTime.getTime();

    // Keystrokes: still attributed by time range + matching exe (correct as-is).
    session.keystrokes = keystrokes.filter((key) => {
      const keyTime = new Date(key.timestamp).getTime();
      return (
        keyTime >= startMs &&
        keyTime <= endMs + gapMs &&
        key.exe_name === session.appName
      );
    });

    session.keystrokeCount = session.keystrokes.reduce(
      (sum, ks) => sum + ks.keys.length,
      0
    );

    session.duration = Math.max(
      0,
      Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 1000)
    );

    session.hasKeystrokes = session.keystrokes.length > 0;
  }

  // Redistribute URLs to browser sessions only.
  redistributeUrlsToBrowserSessions(sessions, urls, gapMs);

  return sessions;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function getSessionColor(session: Session): string {
  if (session.hasKeystrokes && session.hasUrls) return "var(--sentinel-primary)";
  if (session.hasKeystrokes) return "var(--sentinel-success)";
  if (session.hasUrls) return "var(--sentinel-warning)";
  return "var(--awsui-color-text-body-secondary)";
}
