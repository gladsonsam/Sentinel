import { useMemo, useState } from "react";
import { apiUrl } from "../../lib/api";

/** Matches `Sentinel Agent.exe`, `sentinel-agent.exe`, etc. (activity uses lowercase exe basename). */
function isSentinelAgentExeName(lowercaseExe: string): boolean {
  const base = lowercaseExe.replace(/\.exe$/i, "").replace(/\s+/g, "");
  return base === "sentinelagent" || base === "sentinel-agent";
}

export function AppIcon({
  agentId,
  exeName,
  size = 16,
}: {
  agentId: string;
  exeName: string | null | undefined;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const exe = (exeName ?? "").trim().toLowerCase();
  const src = useMemo(() => {
    if (!agentId || !exe) return null;
    return apiUrl(`/agents/${agentId}/app-icons/${encodeURIComponent(exe)}`);
  }, [agentId, exe]);

  const sentinelFallbackSrc = useMemo(() => {
    if (!isSentinelAgentExeName(exe)) return null;
    return `${import.meta.env.BASE_URL}favicon.svg`;
  }, [exe]);

  const imgStyle = {
    width: size,
    height: size,
    borderRadius: 4,
    objectFit: "contain" as const,
    flex: "0 0 auto" as const,
  };

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={imgStyle}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }

  if (sentinelFallbackSrc) {
    return (
      <img
        src={sentinelFallbackSrc}
        alt=""
        width={size}
        height={size}
        style={imgStyle}
        loading="lazy"
      />
    );
  }

  return null;
}

