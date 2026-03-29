import { useState, useRef, useEffect } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Toggle from "@cloudscape-design/components/toggle";
import Modal from "@cloudscape-design/components/modal";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { apiUrl } from "../../lib/api";
import { StreamStatus } from "../common/StatusIndicator";

interface ScreenTabProps {
  agentId: string;
  sendWsMessage: (msg: any) => void;
}

export function ScreenTab({ agentId, sendWsMessage }: ScreenTabProps) {
  const [streaming, setStreaming] = useState(false);
  const [remoteControl, setRemoteControl] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const streamUrl = apiUrl(`/agents/${agentId}/mjpeg`);

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
              <SpaceBetween direction="horizontal" size="xs">
                <StreamStatus streaming={streaming} />
                <Toggle
                  checked={remoteControl}
                  onChange={({ detail }) => setRemoteControl(detail.checked)}
                >
                  Remote control
                </Toggle>
                <Button
                  iconName="notification"
                  onClick={() => setShowNotificationModal(true)}
                >
                  Send notification
                </Button>
                <Button
                  iconName={fullscreen ? "close" : "expand"}
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
        <div
          ref={containerRef}
          className="sentinel-screen-viewer"
          style={{ position: "relative", background: "#000" }}
        >
          <img
            ref={imgRef}
            src={streamUrl}
            alt="Agent screen"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
            }}
            onLoad={() => setStreaming(true)}
            onError={() => setStreaming(false)}
          />
          {remoteControl && (
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
        
        {!streaming && (
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
        header="Send Notification"
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
