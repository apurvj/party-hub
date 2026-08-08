import { motion } from "framer-motion";
import type { LetterState } from "@party-hub/shared";
import { cx } from "../../design-system/index.js";

interface TileProps {
  letter?: string;
  /** A hinted letter shown faintly when the slot is empty (never submitted). */
  ghost?: string;
  state?: LetterState; // undefined = not yet revealed
  /** Reveal delay index (column position) for the staggered flip. */
  revealIndex?: number;
  /** True while the letter is typed but the row isn't submitted. */
  active?: boolean;
}

const stateClasses: Record<LetterState, string> = {
  correct: "bg-tile-correct border-tile-correct text-white",
  present: "bg-tile-present border-tile-present text-white",
  absent: "bg-tile-absent border-tile-absent text-white",
};

// Colorblind-safe glyph shown as a small corner cue (never color alone).
const stateGlyph: Record<LetterState, string> = {
  correct: "●",
  present: "▲",
  absent: "×",
};

export function WordleTile({ letter, ghost, state, revealIndex = 0, active }: TileProps) {
  const revealed = state !== undefined;

  return (
    <motion.div
      className="relative"
      initial={false}
      animate={
        active && !revealed
          ? { scale: [1, 1.08, 1], transition: { duration: 0.12 } }
          : {}
      }
    >
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: "preserve-3d" }}
        initial={false}
        animate={{ rotateX: revealed ? 180 : 0 }}
        transition={{ delay: revealed ? revealIndex * 0.28 : 0, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* front (unrevealed) */}
        <div
          className={cx(
            "flex aspect-square items-center justify-center rounded-md border-2 text-2xl font-bold uppercase sm:text-3xl",
            "backface-hidden",
            letter ? "border-ink-mute/60 text-ink" : "border-border text-ink",
            active && letter ? "border-ink-soft" : "",
            !letter && ghost ? "border-brand/40" : "",
          )}
          style={{ backfaceVisibility: "hidden" }}
        >
          {letter ?? (ghost && <span className="text-brand/45">{ghost}</span>)}
        </div>
        {/* back (revealed with color) */}
        <div
          className={cx(
            "absolute inset-0 flex aspect-square items-center justify-center rounded-md border-2 text-2xl font-bold uppercase sm:text-3xl",
            revealed ? stateClasses[state] : "",
          )}
          style={{ backfaceVisibility: "hidden", transform: "rotateX(180deg)" }}
        >
          {letter}
          {revealed && (
            <span className="absolute right-1 top-0.5 text-[9px] leading-none opacity-80" aria-hidden>
              {stateGlyph[state]}
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
