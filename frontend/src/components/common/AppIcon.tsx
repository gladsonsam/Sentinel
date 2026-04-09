import { useMemo, useState } from "react";
import { apiUrl } from "../../lib/api";

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

  if (!src || broken) return null;

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        objectFit: "contain",
        flex: "0 0 auto",
      }}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

