import { useCallback, useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Toggle from "@cloudscape-design/components/toggle";
import FormField from "@cloudscape-design/components/form-field";
import Modal from "@cloudscape-design/components/modal";
import Input from "@cloudscape-design/components/input";
import { mjpegStreamUrl, notifyMjpegViewerLeft } from "../../lib/api";
import { StreamStatus } from "../common/StatusIndicator";
import Alert from "@cloudscape-design/components/alert";
import type { DashboardRole } from "../../lib/types";

interface ScreenTabProps {
  agentId: string;
  sendWsMessage: (msg: unknown) => void;
  dashboardRole?: DashboardRole | null;
  /** When false, the MJPEG request is not started (tab hidden / navigated away). */
  streamActive?: boolean;
}

export function ScreenTab({
  agentId,
  sendWsMessage,
  dashboardRole = null,
  streamActive = true,
}: ScreenTabProps) {
  const [streaming, setStreaming] = useState(false);
  const [remoteControl, setRemoteControl] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Latest abort — avoids effect cleanups tied to `abortMjpeg` identity (session changes) clearing `<img src>`. */
  const abortMjpegRef = useRef<() => void>(() => {});

  /** Per visit to the screen tab; server ties MJPEG GET + explicit leave to this id. */
  const [mjpegStreamSession, setMjpegStreamSession] = useState("");

  const blockedByRole = dashboardRole === "viewer";
  const streamEnabled = streamActive && !blockedByRole;

  useEffect(() => {
    if (!streamEnabled) return;
    setMjpegStreamSession(crypto.randomUUID());
  }, [agentId, streamEnabled]);

  const streamUrl = useMemo(
    () => (streamEnabled && mjpegStreamSession ? mjpegStreamUrl(agentId, mjpegStreamSession) : ""),
    [streamEnabled, agentId, mjpegStreamSession],
  );

  useEffect(() => {
    if (!streamActive) setRemoteControl(false);
  }, [streamActive]);

  /** Drop MJPEG and notify the server immediately so the agent gets `stop_capture` without waiting on the browser. */
  const abortMjpeg = useCallback(() => {
    const el = imgRef.current;
    if (el) {
      el.removeAttribute("src");
      el.src = "";
      el.removeAttribute("srcset");
    }
    setStreaming(false);
    if (mjpegStreamSession) {
      notifyMjpegViewerLeft(agentId, mjpegStreamSession);
    }
  }, [agentId, mjpegStreamSession]);

  abortMjpegRef.current = abortMjpeg;

  useLayoutEffect(() => {
    if (!streamEnabled) abortMjpegRef.current();
  }, [streamEnabled]);

  useEffect(() => {
    if (!streamEnabled) {
      const wrap = containerRef.current;
      if (wrap && document.fullscreenElement === wrap) {
        void document.exitFullscreen();
      }
    }
  }, [streamEnabled]);

  useEffect(() => {
    return () => {
      abortMjpegRef.current();
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!remoteControl || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imgRef.current.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * imgRef.current.naturalHeight;

    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: { type: "MouseMove", x: Math.floor(x), y: Math.floor(y) },
    });
  };

  const handleMouseClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!remoteControl || !imgRef.current) return;
    e.preventDefault();
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imgRef.current.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * imgRef.current.naturalHeight;
    const button = e.button === 2 ? "right" : "left";
    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: { type: "MouseClick", x: Math.floor(x), y: Math.floor(y), button },
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!remoteControl) return;
    e.preventDefault();

    const keyMap: Record<string, string> = {
      Enter: "enter",
      Backspace: "backspace",
      Tab: "tab",
      Escape: "escape",
    };

    const mapped = keyMap[e.key];
    if (mapped) {
      sendWsMessage({
        type: "control",
        agent_id: agentId,
        cmd: { type: "KeyPress", key: mapped },
      });
      return;
    }
    if (e.key.length === 1) {
      sendWsMessage({
        type: "control",
        agent_id: agentId,
        cmd: { type: "TypeText", text: e.key },
      });
    }
  };

  const handleSendNotification = () => {
    if (!notificationTitle.trim()) return;

    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: {
        type: "Notify",
        title: notificationTitle,
        message: notificationMessage,
      },
    });

    setShowNotificationModal(false);
    setNotificationTitle("");
    setNotificationMessage("");
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  return (
    <>
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="s" alignItems="center">
                <Box padding={{ top: "xs" }}>
                  <StreamStatus streaming={streaming} />
                </Box>
                <Box padding={{ top: "xs" }}>
                  <Toggle
                    checked={remoteControl}
                    disabled={blockedByRole || !streamEnabled}
                    onChange={({ detail }) => setRemoteControl(detail.checked)}
                  >
                    Remote control
                  </Toggle>
                </Box>
                <Button
                  iconName="notification"
                  disabled={blockedByRole || !streamEnabled}
                  onClick={() => setShowNotificationModal(true)}
                >
                  Send notification
                </Button>
                <Button
                  iconName={fullscreen ? "close" : "expand"}
                  disabled={blockedByRole || !streamEnabled}
                  onClick={toggleFullscreen}
                >
                  {fullscreen ? "Exit" : "Fullscreen"}
                </Button>
              </SpaceBetween>
            }
          >
            Screen Viewer
          </Header>
        }
      >
        {blockedByRole ? (
          <Box margin={{ bottom: "m" }}>
            <Alert type="info" header="Operator role required">
              Live screen viewing requires the <strong>operator</strong> or <strong>admin</strong> role. Viewers can still
              use keys, windows, URLs, and other telemetry tabs.
            </Alert>
          </Box>
        ) : null}
        <div
          ref={containerRef}
          className={`sentinel-screen-viewer${fullscreen ? " sentinel-screen-viewer-fullscreen" : ""}`}
          style={{ position: "relative" }}
        >
          <div className="sentinel-screen-frame">
            <img
              key={
                streamEnabled && mjpegStreamSession
                  ? `${agentId}-mjpeg-${mjpegStreamSession}`
                  : `${agentId}-mjpeg-off`
              }
              ref={imgRef}
              src={streamEnabled ? streamUrl : ""}
              alt="Agent screen"
              className="sentinel-screen-image"
              onLoad={() => streamEnabled && setStreaming(true)}
              onError={() => setStreaming(false)}
            />
            {remoteControl && streamEnabled && (
              <div
                className="sentinel-remote-overlay"
                onMouseMove={handleMouseMove}
                onClick={handleMouseClick}
                onContextMenu={handleMouseClick}
                onKeyDown={handleKeyPress}
                tabIndex={0}
                role="button"
                aria-label="Remote control overlay"
              />
            )}
          </div>
        </div>

        {!streaming && streamEnabled && (
          <Box textAlign="center" padding="xxl">
            <Box variant="p" color="text-body-secondary">
              Screen stream not available. Ensure the agent is connected and screen capture is enabled.
            </Box>
          </Box>
        )}
      </Container>

      <Modal
        visible={showNotificationModal}
        onDismiss={() => setShowNotificationModal(false)}
        header="Send notification"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowNotificationModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSendNotification}
                disabled={!notificationTitle.trim()}
              >
                Send
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Title" constraintText="Required">
            <Input
              value={notificationTitle}
              onChange={({ detail }) => setNotificationTitle(detail.value)}
              placeholder="Notification title"
            />
          </FormField>
          <FormField label="Message">
            <Input
              value={notificationMessage}
              onChange={({ detail }) => setNotificationMessage(detail.value)}
              placeholder="Optional message"
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
