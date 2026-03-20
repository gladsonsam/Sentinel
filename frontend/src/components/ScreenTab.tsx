import { useState, useRef, useCallback, useEffect } from "react";
import { MousePointer, Expand, Bell } from "lucide-react";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { Modal } from "./ui/Modal";
import { useToast } from "./ui/ToastProvider";

interface Props {
  agentId: string;
  online: boolean;
  onControl: (cmd: unknown) => void;
}

export function ScreenTab({ agentId, online, onControl }: Props) {
  const [remoteOn, setRemoteOn] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("Sentinel");
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifySending, setNotifySending] = useState(false);
  const throttle = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { pushToast } = useToast();

  // When the client disconnects, remote control should immediately disappear.
  // (Also prevents queued click/move events from firing after disconnect.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!online) setRemoteOn(false);
    if (!online) setCoords(null);
  }, [online]);

  // ── Coordinate mapping ──────────────────────────────────────────────────────
  const toNative = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nw = imgRef.current?.naturalWidth ?? rect.width;
    const nh = imgRef.current?.naturalHeight ?? rect.height;
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * nw),
      y: Math.round(((e.clientY - rect.top) / rect.height) * nh),
    };
  }, []);

  // ── Event handlers ──────────────────────────────────────────────────────────
  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - throttle.current < 50) return; // ~20 events/s
      throttle.current = now;
      const { x, y } = toNative(e);
      setCoords({ x, y });
      onControl({ type: "MouseMove", x, y });
    },
    [toNative, onControl],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { x, y } = toNative(e);
      // Agent expects lowercase button names (serde rename_all="lowercase").
      onControl({ type: "MouseClick", x, y, button: "left" });
    },
    [toNative, onControl],
  );

  const onRightClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const { x, y } = toNative(e);
      onControl({ type: "MouseClick", x, y, button: "right" });
    },
    [toNative, onControl],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!remoteOn) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Prevent page scrolling when controlling remote.
      if (e.key === "Tab" || e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
      }

      if (e.key === "Enter") {
        e.preventDefault();
        onControl({ type: "KeyPress", key: "enter" });
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        onControl({ type: "KeyPress", key: "backspace" });
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        onControl({ type: "KeyPress", key: "tab" });
        return;
      }
      if (e.key === "Escape") {
        onControl({ type: "KeyPress", key: "escape" });
        return;
      }

      // Printable single-character input.
      if (e.key.length === 1) {
        onControl({ type: "TypeText", text: e.key });
      }
    },
    [remoteOn, onControl],
  );

  const onPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!remoteOn) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text") ?? "";
      if (text) onControl({ type: "TypeText", text });
    },
    [remoteOn, onControl],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  const mjpegUrl = api.mjpegUrl(agentId);

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        fullscreen && "fixed inset-0 z-50 bg-bg p-4",
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Live badge */}
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              online ? "bg-ok animate-pulse" : "bg-muted/60",
            )}
          />
          <span className={online ? "text-ok" : "text-muted"}>{online ? "LIVE" : "OFFLINE"}</span>
        </span>

        {/* Remote control toggle (hidden when client is offline) */}
        {online && (
          <button
            onClick={() =>
              setRemoteOn((r) => {
                const next = !r;
                // Focus overlay so typing works immediately after enabling.
                setTimeout(() => overlayRef.current?.focus(), 0);
                return next;
              })
            }
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium",
              "border transition-colors",
              remoteOn
                ? "bg-accent/15 border-accent text-accent"
                : "bg-surface border-border text-muted hover:text-primary",
            )}
          >
            {remoteOn ? (
              <>
                <MousePointer size={12} /> Remote control ON
              </>
            ) : (
              <>
                <MousePointer size={12} className="opacity-40" /> Remote control OFF
              </>
            )}
          </button>
        )}

        {/* Notification button */}
        {online && (
          <button
            onClick={() => {
              setNotifyTitle("Sentinel");
              setNotifyMessage("");
              setNotifyOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                       border border-border bg-surface text-muted hover:text-primary transition-colors"
            title="Send a notification to this client"
          >
            <Bell size={12} />
            Notify
          </button>
        )}

        {/* Cursor co-ordinates */}
        {online && remoteOn && coords && (
          <span className="text-xs text-muted tabular-nums">
            {coords.x} × {coords.y}
          </span>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={() => setFullscreen((f) => !f)}
          className="ml-auto p-1.5 text-muted hover:text-primary transition-colors"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          <Expand size={14} />
        </button>
      </div>

      {/* Stream + overlay */}
      <div className="relative flex-1 flex items-start overflow-auto">
        <div
          className="relative border border-border rounded-md overflow-hidden bg-black
                        inline-block max-w-full"
        >
          {online ? (
            <>
              {/* MJPEG image — browser natively renders the stream */}
              <img
                ref={imgRef}
                src={mjpegUrl}
                alt="Live screen"
                className="block max-w-full h-auto"
                draggable={false}
              />

              {/* Transparent click/move overlay for remote control */}
              {remoteOn && (
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair outline-none"
                  onMouseMove={onMove}
                  onClick={(e) => {
                    overlayRef.current?.focus();
                    onClick(e);
                  }}
                  onContextMenu={onRightClick}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  tabIndex={0}
                  role="application"
                  aria-label="Remote control overlay (click to focus, then type)"
                />
              )}
            </>
          ) : (
            <div className="w-full min-h-[260px] flex items-center justify-center text-muted px-4 py-6 text-sm">
              Client is offline. Remote control is disabled.
            </div>
          )}
        </div>
      </div>

      {/* Hint when remote is off */}
      {online && !remoteOn && (
        <p className="text-xs text-muted">
          Enable <strong className="text-primary">Remote control</strong> to
          click/right-click on the stream.
        </p>
      )}

      {online && remoteOn && (
        <p className="text-xs text-muted">
          Click the stream to focus, then type. Paste also works.
        </p>
      )}

      <Modal
        open={notifyOpen}
        title="Send notification"
        onClose={() => {
          if (notifySending) return;
          setNotifyOpen(false);
        }}
        actions={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNotifyOpen(false)}
              disabled={notifySending}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted hover:text-primary hover:bg-border/30 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const title = notifyTitle.trim() || "Sentinel";
                const message = notifyMessage.trim();
                setNotifySending(true);
                try {
                  onControl({ type: "Notify", title, message });
                  pushToast({
                    variant: "success",
                    title: "Notification sent",
                    message: message ? message : "Sent with an empty message.",
                  });
                  setNotifyOpen(false);
                } finally {
                  setNotifySending(false);
                }
              }}
              disabled={notifySending}
              className="px-4 py-2 rounded-md text-sm font-medium border border-accent bg-accent/10 text-primary hover:bg-accent/20 disabled:opacity-50 transition-colors"
            >
              {notifySending ? "Sending…" : "Send"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted uppercase tracking-widest">
              Title
            </span>
            <input
              type="text"
              value={notifyTitle}
              onChange={(e) => setNotifyTitle(e.target.value)}
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted uppercase tracking-widest">
              Message
            </span>
            <textarea
              value={notifyMessage}
              onChange={(e) => setNotifyMessage(e.target.value)}
              rows={3}
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent transition-colors resize-y"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
