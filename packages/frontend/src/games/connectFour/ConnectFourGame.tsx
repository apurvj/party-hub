import confetti from "canvas-confetti";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CONNECT_FOUR_COLS,
  CONNECT_FOUR_ROWS,
  dropRow,
  type ConnectFourPublicView,
  type GameEvent,
  type Result,
  type RoomStatePayload,
  type Seat,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";

interface ConnectFourGameProps {
  room: RoomStatePayload;
  game: ConnectFourPublicView;
  lastEvent: { seq: number; event: GameEvent } | null;
  onDrop: (column: number) => Promise<Result<null>>;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

// Fixed per-SEAT disc colors so both players agree which color is which seat
// (this is a shared, perfect-information board - unlike the hidden-hand games).
const SEAT_DISC: Record<Seat, string> = {
  A: "bg-[#ef4444]", // red
  B: "bg-[#f5b301]", // gold
};
const SEAT_RING: Record<Seat, string> = {
  A: "ring-[#b91c1c]",
  B: "ring-[#b45309]",
};
const SEAT_EMOJI: Record<Seat, string> = { A: "🔴", B: "🟡" };

function fireConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, disableForReducedMotion: true });
}

export function ConnectFourGame({
  room,
  game,
  lastEvent,
  onDrop,
  onNextRound,
  onRematch,
}: ConnectFourGameProps) {
  const { show } = useToast();
  const reduceMotion = useReducedMotion();
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const opponentName = opponent?.nickname ?? "Opponent";
  const mySeat = game.yourSeat;
  const oppSeat: Seat = mySeat === "A" ? "B" : "A";

  const roundOver = game.roundWinnerSeat !== null;
  const matchOver = game.matchWinnerSeat !== null;
  const yourTurn = game.isYourTurn;

  const [busy, setBusy] = useState(false);
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const openCols = useMemo(() => new Set(game.availableColumns), [game.availableColumns]);
  const winningSet = useMemo(
    () => new Set((game.winningLine ?? []).map((c) => `${c.row},${c.col}`)),
    [game.winningLine],
  );

  // Confetti on your round/match win.
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!lastEvent || lastEvent.seq === handledSeq.current) return;
    handledSeq.current = lastEvent.seq;
    const ev = lastEvent.event;
    if ((ev.kind === "round_over" || ev.kind === "match_over") && ev.winnerSeat === mySeat) {
      fireConfetti();
    }
  }, [lastEvent, mySeat]);

  const canDrop = yourTurn && !busy && !roundOver;

  const drop = useCallback(
    async (col: number) => {
      if (!canDrop) return;
      if (dropRow(game.board, col) === null) return; // column full - no-op
      setBusy(true);
      const res = await onDrop(col);
      setBusy(false);
      if (!res.ok) show(res.error.message, "warning");
    },
    [canDrop, game.board, onDrop, show],
  );

  const myScore = mySeat === "A" ? game.scores.A : game.scores.B;
  const oppScore = mySeat === "A" ? game.scores.B : game.scores.A;

  // Status line under the scoreboard.
  let status: { text: string; tone: "you" | "wait" | "done" };
  if (roundOver) {
    status = { text: "Round over - see the result.", tone: "done" };
  } else if (yourTurn) {
    status = { text: "Your turn - drop a disc into any open column.", tone: "you" };
  } else {
    status = { text: `${opponentName}'s turn - hang tight.`, tone: "wait" };
  }

  return (
    <div className="relative pt-2">
      <Scoreboard
        you={you}
        opponent={opponent}
        mySeat={mySeat}
        oppSeat={oppSeat}
        myScore={myScore}
        oppScore={oppScore}
        roundNumber={game.roundNumber}
        bestOf={game.config.bestOf}
      />

      {/* Status line */}
      <div className="mb-4 text-center">
        <motion.div
          key={status.text}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cx(
            "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold shadow-e1",
            status.tone === "wait"
              ? "bg-surface text-ink-soft"
              : status.tone === "done"
                ? "bg-brand-soft text-brand"
                : "bg-brand text-white shadow-e2",
          )}
        >
          {status.tone === "you" && <span aria-hidden>{SEAT_EMOJI[mySeat]}</span>}
          {status.text}
        </motion.div>
      </div>

      {/* The board */}
      <div className="mx-auto max-w-md">
        <div
          className="rounded-3xl bg-[#1d4ed8] p-2.5 shadow-e3 sm:p-3"
          role="grid"
          aria-label="Connect Four board"
        >
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: CONNECT_FOUR_COLS }, (_, col) => {
              const landingRow = dropRow(game.board, col);
              const colOpen = openCols.has(col);
              const colInteractive = canDrop && colOpen;
              return (
                <button
                  key={col}
                  type="button"
                  role="gridcell"
                  disabled={!colInteractive}
                  aria-label={`Drop in column ${col + 1}${colOpen ? "" : " (full)"}`}
                  onMouseEnter={() => setHoverCol(col)}
                  onMouseLeave={() => setHoverCol((c) => (c === col ? null : c))}
                  onFocus={() => setHoverCol(col)}
                  onBlur={() => setHoverCol((c) => (c === col ? null : c))}
                  onClick={() => void drop(col)}
                  className={cx(
                    "group flex flex-col gap-1.5 rounded-xl p-0.5 outline-none transition-colors sm:gap-2",
                    colInteractive
                      ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-white/80"
                      : "cursor-default",
                  )}
                >
                  {Array.from({ length: CONNECT_FOUR_ROWS }, (_, row) => {
                    const cell = game.board[row]?.[col] ?? null;
                    const isLast =
                      game.lastMove?.row === row && game.lastMove?.col === col;
                    const isWinning = winningSet.has(`${row},${col}`);
                    const showGhost =
                      colInteractive && hoverCol === col && landingRow === row && cell === null;
                    return (
                      <Cell
                        key={row}
                        seat={cell}
                        row={row}
                        justDropped={isLast}
                        winning={isWinning}
                        dimmed={roundOver && winningSet.size > 0 && !isWinning && cell !== null}
                        ghostSeat={showGhost ? mySeat : null}
                        reduceMotion={!!reduceMotion}
                      />
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>

        {/* Column indicators - which are still open */}
        <p className="mt-3 text-center text-xs text-ink-mute">
          {roundOver
            ? "Round complete."
            : yourTurn
              ? "Tap a column to drop your disc."
              : `Waiting for ${opponentName} to move…`}
        </p>
      </div>

      {/* Round / match overlay */}
      <AnimatePresence>
        {roundOver && (
          <RoundOverlay
            game={game}
            mySeat={mySeat}
            opponentName={opponentName}
            matchOver={matchOver}
            onNextRound={onNextRound}
            onRematch={onRematch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- a single board cell ----------------------------------------------------

function Cell({
  seat,
  row,
  justDropped,
  winning,
  dimmed,
  ghostSeat,
  reduceMotion,
}: {
  seat: Seat | null;
  row: number;
  justDropped: boolean;
  winning: boolean;
  dimmed: boolean;
  ghostSeat: Seat | null;
  reduceMotion: boolean;
}) {
  return (
    <span className="relative block aspect-square w-full rounded-full bg-[#0f2d8c] shadow-inner">
      {/* The hole (empty socket) is the dark inset above; a disc sits on top. */}
      {seat && (
        <motion.span
          className={cx(
            "absolute inset-[6%] rounded-full ring-2 ring-inset",
            SEAT_DISC[seat],
            SEAT_RING[seat],
            winning ? "ring-4 ring-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" : "",
            dimmed ? "opacity-45" : "",
          )}
          // Fall in from above only for the just-dropped disc. Distance scales with
          // the row so it looks like it drops down the column. Others render static.
          initial={
            reduceMotion || !justDropped
              ? false
              : { y: `-${(row + 1) * 115}%`, opacity: 0.85 }
          }
          animate={{ y: 0, opacity: dimmed ? 0.45 : 1 }}
          transition={
            reduceMotion || !justDropped
              ? { duration: 0 }
              : { type: "spring", stiffness: 520, damping: 26, mass: 0.9 }
          }
        />
      )}
      {/* Hover preview of where your disc would land. */}
      {!seat && ghostSeat && (
        <span
          className={cx(
            "absolute inset-[6%] rounded-full opacity-30 ring-2 ring-inset",
            SEAT_DISC[ghostSeat],
            SEAT_RING[ghostSeat],
          )}
          aria-hidden
        />
      )}
    </span>
  );
}

// ---- scoreboard -------------------------------------------------------------

function Scoreboard({
  you,
  opponent,
  mySeat,
  oppSeat,
  myScore,
  oppScore,
  roundNumber,
  bestOf,
}: {
  you: RoomStatePayload["you"];
  opponent: RoomStatePayload["players"][number] | null;
  mySeat: Seat;
  oppSeat: Seat;
  myScore: number;
  oppScore: number;
  roundNumber: number;
  bestOf: number;
}) {
  return (
    <div className="mx-auto mb-3 flex max-w-md items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {SEAT_EMOJI[mySeat]}
        </span>
        <PlayerBadge nickname={you.nickname} you connected size="sm" />
        <span className="font-display text-2xl font-bold text-ink">{myScore}</span>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
          Round {roundNumber}
        </div>
        <div className="text-xs text-ink-mute">Connect Four · Best of {bestOf}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-display text-2xl font-bold text-ink">{oppScore}</span>
        {opponent ? (
          <PlayerBadge nickname={opponent.nickname} connected={opponent.connected} size="sm" />
        ) : (
          <span className="text-xs text-ink-mute">-</span>
        )}
        <span aria-hidden className="text-lg">
          {SEAT_EMOJI[oppSeat]}
        </span>
      </div>
    </div>
  );
}

// ---- round / match overlay --------------------------------------------------

function RoundOverlay({
  game,
  mySeat,
  opponentName,
  matchOver,
  onNextRound,
  onRematch,
}: {
  game: ConnectFourPublicView;
  mySeat: Seat;
  opponentName: string;
  matchOver: boolean;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}) {
  const { show } = useToast();
  const [readying, setReadying] = useState(false);
  const [rematching, setRematching] = useState(false);
  const iWonRound = game.roundWinnerSeat === mySeat;
  const roundTie = game.roundWinnerSeat === "tie";
  const matchWinner = game.matchWinnerSeat;

  let title: string;
  let subtitle: string | null = null;
  if (matchOver) {
    if (matchWinner === "tie") title = "It's a tie! 🤝";
    else title = matchWinner === mySeat ? "You win the match! 🏆" : "You lost the match";
  } else if (roundTie) {
    title = "Board full - it's a draw 🤝";
    subtitle = game.roundDraw ? "Nobody connected four. No point this round." : null;
  } else if (iWonRound) {
    title = "You won the round! 🎉";
    subtitle = "Four in a row!";
  } else {
    title = `${opponentName} won the round`;
    subtitle = `${opponentName} connected four.`;
  }

  const waitingForOpponent = game.youReady && !game.opponentReady && !matchOver;

  const clickNext = useCallback(async () => {
    if (readying) return;
    setReadying(true);
    const res = await onNextRound();
    if (!res.ok) {
      show(res.error.message, "warning");
      setReadying(false);
    }
  }, [readying, onNextRound, show]);

  const clickRematch = useCallback(async () => {
    if (rematching) return;
    setRematching(true);
    const res = await onRematch();
    // On success the server pushes a fresh in_game state and this overlay
    // unmounts; only re-enable the button if it failed, so we can retry.
    if (!res.ok) {
      show(res.error.message, "warning");
      setRematching(false);
    }
  }, [rematching, onRematch, show]);

  return (
    <ModalShell
      labelledBy="c4-round-overlay-title"
      zClass="z-50"
      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 text-center shadow-e5"
    >
      <div>
        <div className="mb-4 flex justify-center gap-3">
          <ScorePill label="You" value={mySeat === "A" ? game.scores.A : game.scores.B} highlight />
          <span className="self-center text-ink-mute">vs</span>
          <ScorePill label="Them" value={mySeat === "A" ? game.scores.B : game.scores.A} />
        </div>
        <h2 id="c4-round-overlay-title" className="font-display text-2xl font-bold text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}

        <div className="mt-6">
          {matchOver ? (
            <Button fullWidth size="lg" loading={rematching} onClick={() => void clickRematch()}>
              Play again
            </Button>
          ) : waitingForOpponent ? (
            <Button fullWidth size="lg" variant="secondary" onClick={() => void clickNext()}>
              <span
                className="h-4 w-4 rounded-full border-2 border-ink-mute/40 border-t-brand animate-spin"
                aria-hidden
              />
              Waiting for {opponentName}…
            </Button>
          ) : (
            <Button fullWidth size="lg" loading={readying} onClick={() => void clickNext()}>
              {game.opponentReady ? `${opponentName} is ready - Next round →` : "I'm ready →"}
            </Button>
          )}
        </div>
      </div>
    </ModalShell>
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

// ---- accessible modal shell -------------------------------------------------

/**
 * Focus-trapping, Escape-closable backdrop for the round/match overlay. Mirrors
 * the shared a11y contract used by the other games' dialogs (role/aria-modal,
 * initial focus, a Tab focus-trap, reduced-motion handling). The round overlay
 * omits `onClose` - it must be actioned (ready-up or rematch), not dismissed.
 */
function ModalShell({
  onClose,
  labelledBy,
  className,
  zClass = "z-40",
  children,
}: {
  onClose?: () => void;
  labelledBy?: string;
  className?: string;
  zClass?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    (focusables()[0] ?? panel).focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <motion.div
      className={cx("fixed inset-0 grid place-items-center bg-ink/40 p-4", zClass)}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => onClose?.()}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        initial={reduceMotion ? false : { scale: 0.9, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={cx("outline-none", className)}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
