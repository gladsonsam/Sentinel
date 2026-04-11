import type { CSSProperties } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { isUserPhotoDataUrl, parseUserLucideIcon } from "../../lib/userAvatar";

function initialsFromUsername(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0] ?? "";
    const b = parts[1][0] ?? "";
    return (a + b).toUpperCase().slice(0, 2);
  }
  return cleaned.slice(0, 2).toUpperCase();
}

const hashHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

export interface DashboardUserAvatarProps {
  username: string;
  displayIcon?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Circle avatar: optional Lucide icon key, photo data URL, or short legacy glyph; otherwise colored initials. */
export function DashboardUserAvatar({
  username,
  displayIcon,
  size = 36,
  className,
  style,
}: DashboardUserAvatarProps) {
  const raw = displayIcon?.trim() ?? "";
  const hue = hashHue(username || "user");
  const bg = `hsl(${hue} 42% 36%)`;
  const fg = "hsl(0 0% 98%)";

  if (isUserPhotoDataUrl(raw)) {
    return (
      <img
        className={`sentinel-user-avatar sentinel-user-avatar--photo ${className ?? ""}`}
        src={raw}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          borderRadius: "50%",
          flexShrink: 0,
          ...style,
        }}
        title={username}
      />
    );
  }

  const lucideName = parseUserLucideIcon(raw);
  if (lucideName) {
    const Cmp = (LucideIcons as unknown as Record<string, LucideIcon>)[lucideName];
    if (Cmp) {
      return (
        <span
          className={`sentinel-user-avatar sentinel-user-avatar--lucide ${className ?? ""}`}
          style={{
            width: size,
            height: size,
            background: bg,
            color: fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            flexShrink: 0,
            ...style,
          }}
          title={username}
          aria-hidden
        >
          <Cmp size={Math.max(14, size * 0.52)} strokeWidth={2} color={fg} />
        </span>
      );
    }
  }

  if (raw.length > 0) {
    return (
      <span
        className={`sentinel-user-avatar sentinel-user-avatar--glyph ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(14, size * 0.52),
          ...style,
        }}
        title={username}
        aria-hidden
      >
        {raw}
      </span>
    );
  }

  const initials = initialsFromUsername(username);
  return (
    <span
      className={`sentinel-user-avatar sentinel-user-avatar--initials ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: bg,
        color: fg,
        ...style,
      }}
      title={username}
      aria-label={`${username} avatar`}
    >
      {initials}
    </span>
  );
}
