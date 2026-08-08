import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WORD_LENGTH,
  type GameEvent,
  type Result,
  type RoomStatePayload,
  type Seat,
  type WordlePublicView,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";
import { OpponentProgress } from "./OpponentProgress.js";
import { WordleBoard } from "./WordleBoard.js";
import { WordleKeyboard } from "./WordleKeyboard.js";

interface WordleGameProps {
  room: RoomStatePayload;
  game: WordlePublicView;
  lastEvent: { seq: number; event: GameEvent } | null;
  onGuess: (guess: string) => Promise<Result<null>>;
  onNextRound: () => Promise<Result<null>>;
  onHint: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

function fireConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, disableForReducedMotion: true });
}

export function WordleGame({ room, game, lastEvent, onGuess, onNextRound, onHint, onRematch }: WordleGameProps) {
  const { show } = useToast();
  const [typed, setTyped] = useState("");
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hinting, setHinting] = useState(false);

  const isCoop = game.config.mode === "coop";
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const mySeat = (room.yourSeat ?? "A") as Seat;

  const roundOver = game.roundStatus === "over";
  const matchOver = game.matchWinnerSeat !== null;
  // Co-op: only the seat the server says is "up" may type. The server is still
  // authoritative (it re-validates every guess), but reflecting the real turn
  // here stops both players seeing "your turn" and typing into a wall.
  const myTurnCoop = !isCoop || game.coopTurn === mySeat;
  const canType =
    !roundOver && !matchOver && game.self.status === "playing" && myTurnCoop;

  // reset typed row whenever a new guess lands or round changes
  useEffect(() => {
    setTyped("");
  }, [game.self.guesses.length, game.roundNumber]);

  // react to transient events (confetti on your win / round result toast)
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!lastEvent || lastEvent.seq === handledSeq.current) return;
    handledSeq.current = lastEvent.seq;
    const ev = lastEvent.event;
    if (ev.kind === "round_over") {
      const iWon = ev.winnerSeat === mySeat || (isCoop && ev.winnerSeat === "tie");
      if (iWon) fireConfetti();
    }
    if (ev.kind === "match_over") {
      const iWon = ev.winnerSeat === mySeat || (isCoop && ev.winnerSeat === "tie");
      if (iWon) fireConfetti();
    }
  }, [lastEvent, mySeat, isCoop]);

  const submit = useCallback(async () => {
    if (typed.length !== WORD_LENGTH || submitting) return;
    setSubmitting(true);
    const res = await onGuess(typed);
    setSubmitting(false);
    if (!res.ok) {
      setShakeRow(game.self.guesses.length);
      show(res.error.message, "warning");
      window.setTimeout(() => setShakeRow(null), 450);
    } else {
      setTyped("");
    }
  }, [typed, submitting, onGuess, game.self.guesses.length, show]);

  const handleKey = useCallback(
    (key: string) => {
      if (!canType) return;
      if (key === "ENTER" || key === "Enter") return void submit();
      if (key === "⌫" || key === "Backspace") return setTyped((t) => t.slice(0, -1));
      const ch = key.toUpperCase();
      if (/^[A-Z]$/.test(ch)) setTyped((t) => (t.length < WORD_LENGTH ? t + ch : t));
    },
    [canType, submit],
  );

  const requestHint = useCallback(async () => {
    if (hinting || !game.self.canHint) return;
    setHinting(true);
    const res = await onHint();
    setHinting(false);
    if (!res.ok) show(res.error.message, "warning");
  }, [hinting, game.self.canHint, onHint, show]);

  // physical keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleKey(e.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  const scoreA = game.scores.A;
  const scoreB = game.scores.B;
  const myScore = mySeat === "A" ? scoreA : scoreB;
  const oppScore = mySeat === "A" ? scoreB : scoreA;

  return (
    <div className="relative pt-2">
      {/* Scoreboard */}
      <div className="mx-auto mb-4 flex max-w-md items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
        <div className="flex items-center gap-2">
          <PlayerBadge nickname={you.nickname} you connected size="sm" />
          <span className="font-display text-2xl font-bold text-ink">{myScore}</span>
        </div>
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
            Round {game.roundNumber}
          </div>
          <div className="text-xs text-ink-mute">
            {isCoop ? "Co-op" : "Race"} · Best of {game.config.bestOf}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl font-bold text-ink">{oppScore}</span>
          {opponent ? (
            <PlayerBadge nickname={opponent.nickname} connected={opponent.connected} size="sm" />
          ) : (
            <span className="text-xs text-ink-mute">—</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start md:justify-center">
        {/* Your board + keyboard */}
        <div className="flex flex-col items-center gap-5">
          <WordleBoard
            guesses={game.self.guesses}
            feedback={game.self.feedback}
            current={typed}
            shakeRow={shakeRow}
            hint={game.self.hint}
          />
          {isCoop && !roundOver && (
            <motion.div
              key={canType ? "your-turn" : "their-turn"}
              className="text-sm font-medium text-ink-soft"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {canType ? "Your turn — type a guess" : "Waiting for your partner…"}
            </motion.div>
          )}
          <HintControl
            game={game}
            canType={canType}
            hinting={hinting}
            onHint={requestHint}
          />
          <WordleKeyboard
            guesses={game.self.guesses}
            feedback={game.self.feedback}
            onKey={handleKey}
            disabled={!canType}
          />
        </div>

        {/* Opponent panel (race only) */}
        {!isCoop && game.opponent && opponent && (
          <div className="mx-auto w-full max-w-[16rem] md:w-56">
            <OpponentProgress
              opponent={game.opponent}
              nickname={opponent.nickname}
              connected={opponent.connected}
            />
          </div>
        )}
      </div>

      {/* Round / match overlay */}
      <AnimatePresence>
        {roundOver && (
          <RoundOverlay
            game={game}
            mySeat={mySeat}
            opponentName={opponent?.nickname ?? "Opponent"}
            matchOver={matchOver}
            onNextRound={onNextRound}
            onRematch={onRematch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The "last two guesses" hint control. Renders nothing until a hint is
 * available or has been used — so it never nags early. The server is the
 * authority on `canHint`; this just reflects and requests.
 */
function HintControl({
  game,
  canType,
  hinting,
  onHint,
}: {
  game: WordlePublicView;
  canType: boolean;
  hinting: boolean;
  onHint: () => void;
}) {
  const roundOver = game.roundStatus === "over";
  const hint = game.self.hint;
  if (roundOver) return null;

  // Already spent this round's hint → show what it revealed.
  if (hint) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-sm text-brand"
      >
        <span aria-hidden>💡</span>
        <span className="font-medium">
          Letter {hint.index + 1} is{" "}
          <span className="font-display font-bold uppercase">{hint.letter}</span>
        </span>
      </motion.div>
    );
  }

  if (!game.self.canHint) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <Button
        variant="secondary"
        size="sm"
        loading={hinting}
        disabled={!canType}
        onClick={onHint}
        className="gap-1.5"
      >
        <span aria-hidden>💡</span> Reveal a letter
      </Button>
    </motion.div>
  );
}

function RoundOverlay({
  game,
  mySeat,
  opponentName,
  matchOver,
  onNextRound,
  onRematch,
}: {
  game: WordlePublicView;
  mySeat: Seat;
  opponentName: string;
  matchOver: boolean;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}) {
  const isCoop = game.config.mode === "coop";
  const matchWinner = game.matchWinnerSeat; // set only when the match ends
  const roundWinner = game.roundWinnerSeat; // set every round-over
  const iSolved = game.self.status === "won";
  const [readying, setReadying] = useState(false);

  // Once we've signaled ready, wait for the opponent. The button reflects this.
  const waitingForOpponent = game.youReady && !game.opponentReady && !matchOver;

  let title: string;
  if (matchOver) {
    if (matchWinner === "tie") title = "It's a tie! 🤝";
    else title = matchWinner === mySeat ? "You win the match! 🏆" : "You lost the match";
  } else if (isCoop) {
    title = iSolved ? "Solved together! 🎉" : "Out of guesses";
  } else {
    // Race: use the ROUND winner (matchWinnerSeat is null until the match ends).
    if (iSolved) title = "Nice — you got it! 🎉";
    else if (roundWinner === mySeat) title = "You win the round!";
    else if (roundWinner && roundWinner !== "tie") title = `${opponentName} solved it first`;
    else title = "Nobody got it";
  }

  const clickNext = useCallback(async () => {
    if (readying) return;
    setReadying(true);
    const res = await onNextRound();
    // Leave the button in its ready/waiting state on success; re-enable on error.
    if (!res.ok) setReadying(false);
  }, [readying, onNextRound]);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(4px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 text-center shadow-e5"
      >
        <div className="mb-4 flex justify-center gap-3">
          <ScorePill label="You" value={mySeat === "A" ? game.scores.A : game.scores.B} highlight />
          <span className="self-center text-ink-mute">vs</span>
          <ScorePill label="Them" value={mySeat === "A" ? game.scores.B : game.scores.A} />
        </div>
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>

        {/* The answer is ALWAYS shown once the round is over — so whoever didn't
            solve it (ran out of guesses, or got beaten to it) still learns it. */}
        {game.revealedAnswer && (
          <p className="mt-1 text-ink-soft">
            {matchOver ? `Final score ${game.scores.A}–${game.scores.B} · the word was ` : "The word was "}
            <span className="font-display font-bold uppercase tracking-wide text-brand">
              {game.revealedAnswer}
            </span>
          </p>
        )}

        <div className="mt-6">
          {matchOver ? (
            <Button fullWidth size="lg" onClick={() => void onRematch()}>
              Play again
            </Button>
          ) : waitingForOpponent ? (
            // Still an interactive button (not a dead spinner): re-clicking while
            // both are present is a harmless idempotent no-op, and it's the
            // escape hatch if the opponent leaves — the server lets a lone
            // occupant advance solo rather than waiting forever.
            <Button fullWidth size="lg" variant="secondary" onClick={() => void clickNext()}>
              <span
                className="h-4 w-4 rounded-full border-2 border-ink-mute/40 border-t-brand animate-spin"
                aria-hidden
              />
              Waiting for {opponentName}…
            </Button>
          ) : (
            <Button fullWidth size="lg" loading={readying} onClick={() => void clickNext()}>
              {game.opponentReady ? `${opponentName} is ready — Next round →` : "I'm ready →"}
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ScorePill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-xl px-4 py-2",
        highlight ? "bg-brand-soft" : "bg-surface-2",
      )}
    >
      <span className="text-xs font-medium text-ink-mute">{label}</span>
      <span className="font-display text-2xl font-bold text-ink">{value}</span>
    </div>
  );
}
