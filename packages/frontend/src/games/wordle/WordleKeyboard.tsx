import { motion } from "framer-motion";
import { useMemo } from "react";
import type { GuessFeedback, LetterState } from "@party-hub/shared";
import { cx } from "../../design-system/index.js";

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/** Priority so a key that's ever been correct stays green. */
const rank: Record<LetterState, number> = { absent: 1, present: 2, correct: 3 };

function computeKeyStates(guesses: string[], feedback: GuessFeedback[]): Record<string, LetterState> {
  const map: Record<string, LetterState> = {};
  guesses.forEach((g, gi) => {
    const fb = feedback[gi];
    if (!fb) return;
    for (let i = 0; i < g.length; i++) {
      const letter = g[i]!.toUpperCase();
      const st = fb[i]!.state;
      const prev = map[letter];
      if (!prev || rank[st] > rank[prev]) map[letter] = st;
    }
  });
  return map;
}

const keyColor: Record<LetterState, string> = {
  correct: "bg-tile-correct text-white",
  present: "bg-tile-present text-white",
  absent: "bg-tile-absent text-white",
};

interface KeyboardProps {
  guesses: string[];
  feedback: GuessFeedback[];
  onKey: (key: string) => void;
  disabled?: boolean;
}

export function WordleKeyboard({ guesses, feedback, onKey, disabled }: KeyboardProps) {
  const states = useMemo(() => computeKeyStates(guesses, feedback), [guesses, feedback]);

  const renderKey = (key: string, wide = false) => {
    const st = states[key];
    return (
      <motion.button
        key={key}
        whileTap={{ scale: 0.9 }}
        disabled={disabled}
        onClick={() => onKey(key)}
        className={cx(
          "h-12 rounded-md text-sm font-semibold uppercase transition-colors sm:h-14",
          wide ? "px-2 text-xs" : "flex-1",
          st ? keyColor[st] : "bg-surface-2 text-ink hover:bg-border",
          disabled && "opacity-60",
        )}
        aria-label={key === "⌫" ? "Backspace" : key === "ENTER" ? "Enter" : key}
      >
        {key}
      </motion.button>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-1.5 select-none">
      <div className="flex gap-1.5">{ROWS[0]!.split("").map((k) => renderKey(k))}</div>
      <div className="flex gap-1.5 px-4">{ROWS[1]!.split("").map((k) => renderKey(k))}</div>
      <div className="flex gap-1.5">
        {renderKey("ENTER", true)}
        {ROWS[2]!.split("").map((k) => renderKey(k))}
        {renderKey("⌫", true)}
      </div>
    </div>
  );
}
