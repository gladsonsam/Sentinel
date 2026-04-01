import StatusIndicator, { StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";

interface ConnectionStatusProps {
  connected: boolean;
  lastSeen?: Date | null;
}

export function ConnectionStatus({ connected, lastSeen }: ConnectionStatusProps) {
  if (connected) {
    return <StatusIndicator type="success">Connected</StatusIndicator>;
  }

  const getOfflineText = () => {
    if (!lastSeen) return "Disconnected";
    const now = Date.now();
    const lastSeenMs = lastSeen.getTime();
    const diffMs = now - lastSeenMs;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `Disconnected (${diffDay}d ago)`;
    if (diffHour > 0) return `Disconnected (${diffHour}h ago)`;
    if (diffMin > 0) return `Disconnected (${diffMin}m ago)`;
    return `Disconnected (${diffSec}s ago)`;
  };

  return <StatusIndicator type="stopped">{getOfflineText()}</StatusIndicator>;
}

interface ActivityStatusProps {
  isAfk: boolean;
  idleSeconds?: number;
}

export function ActivityStatus({ isAfk, idleSeconds }: ActivityStatusProps) {
  if (isAfk) {
    const idleText = idleSeconds
      ? ` (${Math.floor(idleSeconds / 60)}m idle)`
      : "";
    return (
      <StatusIndicator type="warning">
        AFK{idleText}
      </StatusIndicator>
    );
  }

  return <StatusIndicator type="success">Active</StatusIndicator>;
}

interface StreamStatusProps {
  streaming: boolean;
}

export function StreamStatus({ streaming }: StreamStatusProps) {
  if (streaming) {
    return (
      <StatusIndicator type="in-progress">
        <span className="sentinel-pulse">Streaming</span>
      </StatusIndicator>
    );
  }

  return <StatusIndicator type="stopped">Not streaming</StatusIndicator>;
}

interface GenericStatusProps {
  type: StatusIndicatorProps.Type;
  children: React.ReactNode;
}

export function GenericStatus({ type, children }: GenericStatusProps) {
  return <StatusIndicator type={type}>{children}</StatusIndicator>;
}
