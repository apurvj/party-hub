import { motion } from "framer-motion";
import { MAX_GUESSES, WORD_LENGTH, type GuessFeedback } from "@party-hub/shared";
import { WordleTile } from "./WordleTile.js";

interface BoardProps {
  guesses: string[];
  feedback: GuessFeedback[];
  current: string; // the in-progress typed row
  /** Row index that should shake (invalid word), or null. */
  shakeRow: number | null;
  /** One revealed hint letter + position, ghosted into the current row. */
  hint?: { index: number; letter: string } | null;
  disabled?: boolean;
}

export function WordleBoard({ guesses, feedback, current, shakeRow, hint }: BoardProps) {
  const rows = Array.from({ length: MAX_GUESSES });
  const currentRowIndex = guesses.length;

  return (
    <div className="mx-auto grid w-full max-w-[20rem] gap-1.5">
      {rows.map((_, r) => {
        const submitted = r < guesses.length;
        const isCurrent = r === currentRowIndex;
        const word = submitted ? guesses[r]! : isCurrent ? current : "";
        const fb = submitted ? feedback[r] : undefined;

        return (
          <motion.div
            key={r}
            className="grid grid-cols-5 gap-1.5"
            animate={shakeRow === r ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
          >
            {Array.from({ length: WORD_LENGTH }).map((__, c) => {
              const typed = word[c]?.toUpperCase();
              // Show the hint as a faint ghost only on the current row, at its
              // position, and only where the player hasn't typed over it yet.
              const ghost =
                isCurrent && !typed && hint && hint.index === c ? hint.letter : undefined;
              return (
                <WordleTile
                  key={c}
                  letter={typed}
                  ghost={ghost}
                  state={fb?.[c]?.state}
                  revealIndex={c}
                  active={isCurrent && c === current.length - 1}
                />
              );
            })}
          </motion.div>
        );
      })}
    </div>
  );
}
