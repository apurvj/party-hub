import { motion } from "framer-motion";
import { MAX_GUESSES, WORD_LENGTH, type LetterState, type OpponentRoundView } from "@party-hub/shared";
import { cx, PlayerBadge } from "../../design-system/index.js";

const dot: Record<LetterState, string> = {
  correct: "bg-tile-correct",
  present: "bg-tile-present",
  absent: "bg-tile-absent",
};

/**
 * Opponent's board rendered as colored blocks only — you feel the race without
 * seeing their letters (which would leak the answer). This mirrors the classic
 * shared-Wordle "emoji grid".
 */
export function OpponentProgress({
  opponent,
  nickname,
  connected,
}: {
  opponent: OpponentRoundView;
  nickname: string;
  connected: boolean;
}) {
  const rows = Array.from({ length: MAX_GUESSES });
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <PlayerBadge nickname={nickname} connected={connected} size="sm" />
        <span className="text-xs font-medium text-ink-mute">
          {opponent.status === "won"
            ? `Solved in ${opponent.solvedInGuesses}`
            : opponent.status === "lost"
              ? "Out of guesses"
              : `${opponent.rowStates.length}/${MAX_GUESSES}`}
        </span>
      </div>
      <div className="grid gap-1">
        {rows.map((_, r) => {
          const row = opponent.rowStates[r];
          return (
            <div key={r} className="grid grid-cols-5 gap-1">
              {Array.from({ length: WORD_LENGTH }).map((__, c) => {
                const st = row?.[c];
                return (
                  <motion.div
                    key={c}
                    initial={st ? { scale: 0.4, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: c * 0.05 }}
                    className={cx("aspect-square rounded-sm", st ? dot[st] : "bg-surface border border-border")}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
