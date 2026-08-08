import { cx } from "./cx.js";

/** Deterministic avatar color + initials from a nickname. */
function hueFrom(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface PlayerBadgeProps {
  nickname: string;
  connected?: boolean;
  you?: boolean;
  seat?: "A" | "B" | null;
  size?: "sm" | "md";
}

export function PlayerBadge({ nickname, connected = true, you, seat, size = "md" }: PlayerBadgeProps) {
  const hue = hueFrom(nickname || "?");
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative">
        <div
          className={cx("grid place-items-center rounded-full font-bold text-white shadow-e1", dim)}
          style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 48%))` }}
        >
          {initials(nickname || "?")}
        </div>
        <span
          className={cx(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface",
            connected ? "bg-success" : "bg-ink-mute",
          )}
          aria-label={connected ? "online" : "offline"}
        />
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink">{nickname || "Waiting…"}</span>
          {you && (
            <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-brand">
              you
            </span>
          )}
        </div>
        {seat && <span className="text-xs text-ink-mute">Player {seat}</span>}
      </div>
    </div>
  );
}
