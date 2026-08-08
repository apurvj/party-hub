import { cx } from "./cx.js";
import logoUrl from "../assets/logo.png";

/**
 * The Party Hub brand mark: a circular avatar sticker. It ships as a raster
 * asset (a hand-illustrated portrait, transparent background) rather than the
 * old vector die, so we render it inside a round frame with a soft ring +
 * shadow so it reads as a crisp "coin" at any size. Decorative, so it's
 * aria-hidden; the wordmark beside it carries the accessible name.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden
      draggable={false}
      className={cx("shrink-0 select-none rounded-full object-cover", className)}
    />
  );
}

/**
 * Full lockup: the mark + a two-tone "Party Hub" wordmark. `Party` in ink,
 * `Hub` in a brand→accent gradient so the name has a subtle finish without
 * shouting.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <LogoMark className="h-9 w-9 shadow-e2 ring-1 ring-black/5 transition-transform group-hover:-rotate-6 group-hover:scale-105" />
      <span className="font-display text-xl font-bold tracking-tight text-ink">
        Party
        <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent">
          {" "}
          Hub
        </span>
      </span>
    </span>
  );
}
