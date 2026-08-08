import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isWildKind,
  type GameEvent,
  type Result,
  type RoomStatePayload,
  type Seat,
  type UnoColor,
  type UnoPublicView,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";
import { UnoCardBack, UnoCardView } from "./UnoCardView.js";

interface UnoGameProps {
  room: RoomStatePayload;
  game: UnoPublicView;
  lastEvent: { seq: number; event: GameEvent } | null;
  onPlay: (cardId: string, chosenColor?: UnoColor) => Promise<Result<null>>;
  onDraw: () => Promise<Result<null>>;
  onPass: () => Promise<Result<null>>;
  onCallUno: () => Promise<Result<null>>;
  onCatch: () => Promise<Result<null>>;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

const COLOR_SWATCH: Record<UnoColor, string> = {
  red: "bg-[#d81e18]",
  yellow: "bg-[#f0a800]",
  green: "bg-[#1f9d3f]",
  blue: "bg-[#1f5fd6]",
};

/** Raw hex per color — used for the active-color glow around the discard pile. */
const COLOR_HEX: Record<UnoColor, string> = {
  red: "#f04a43",
  yellow: "#ffc933",
  green: "#3fbe5b",
  blue: "#3f83ee",
};

function fireConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, disableForReducedMotion: true });
}

export function UnoGame({
  room,
  game,
  lastEvent,
  onPlay,
  onDraw,
  onPass,
  onCallUno,
  onCatch,
  onNextRound,
  onRematch,
}: UnoGameProps) {
  const { show } = useToast();
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const mySeat = (room.yourSeat ?? "A") as Seat;

  const roundOver = game.roundWinnerSeat !== null;
  const matchOver = game.matchWinnerSeat !== null;
  const myTurn = game.turn === mySeat && !roundOver;

  // Wild color-pick flow: hold the pending card until a color is chosen.
  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // clear any pending wild selection when the turn/round changes under us
  useEffect(() => {
    setPendingWild(null);
  }, [game.turn, game.roundNumber, game.topCard.id]);

  // confetti on your round/match win
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!lastEvent || lastEvent.seq === handledSeq.current) return;
    handledSeq.current = lastEvent.seq;
    const ev = lastEvent.event;
    if ((ev.kind === "round_over" || ev.kind === "match_over") && ev.winnerSeat === mySeat) {
      fireConfetti();
    }
  }, [lastEvent, mySeat]);

  const playable = new Set(game.playableCardIds);

  const clickCard = useCallback(
    async (cardId: string, kind: UnoPublicView["hand"][number]["kind"]) => {
      if (!myTurn || busy || !playable.has(cardId)) return;
      if (isWildKind(kind)) {
        setPendingWild(cardId); // ask for a color first
        return;
      }
      setBusy(true);
      const res = await onPlay(cardId);
      setBusy(false);
      if (!res.ok) show(res.error.message, "warning");
    },
    [myTurn, busy, playable, onPlay, show],
  );

  const chooseColor = useCallback(
    async (color: UnoColor) => {
      if (!pendingWild) return;
      setBusy(true);
      const res = await onPlay(pendingWild, color);
      setBusy(false);
      setPendingWild(null);
      if (!res.ok) show(res.error.message, "warning");
    },
    [pendingWild, onPlay, show],
  );

  const draw = useCallback(async () => {
    if (!myTurn || busy) return;
    setBusy(true);
    const res = await onDraw();
    setBusy(false);
    if (!res.ok) show(res.error.message, "warning");
  }, [myTurn, busy, onDraw, show]);

  const pass = useCallback(async () => {
    if (!myTurn || busy) return;
    setBusy(true);
    const res = await onPass();
    setBusy(false);
    if (!res.ok) show(res.error.message, "warning");
  }, [myTurn, busy, onPass, show]);

  const callUno = useCallback(async () => {
    const res = await onCallUno();
    if (!res.ok) show(res.error.message, "warning");
    else show("UNO!", "success");
  }, [onCallUno, show]);

  const doCatch = useCallback(async () => {
    const res = await onCatch();
    if (!res.ok) show(res.error.message, "warning");
    else show("Caught them! +2", "success");
  }, [onCatch, show]);

  const myScore = mySeat === "A" ? game.scores.A : game.scores.B;
  const oppScore = mySeat === "A" ? game.scores.B : game.scores.A;

  // You should call UNO when you're about to be / are on one card and haven't.
  const shouldOfferUnoCall = game.hand.length === 1 && !game.youCalledUno && !roundOver;

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
          <div className="text-xs text-ink-mute">Uno · Best of {game.config.bestOf}</div>
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

      {/* Opponent hand (face down) + count + catch */}
      <div className="mx-auto mb-4 flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <PlayerBadge
            nickname={opponent?.nickname ?? "Waiting…"}
            connected={opponent?.connected ?? false}
            size="sm"
          />
          <div className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">{game.opponentCardCount}</span> cards
            {game.opponentCalledUno && (
              <span className="ml-2 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning">
                UNO!
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center -space-x-6">
          {Array.from({ length: Math.min(game.opponentCardCount, 7) }).map((_, i) => (
            <UnoCardBack key={i} size="sm" />
          ))}
        </div>
        {game.canCatchOpponent && (
          <Button size="sm" variant="danger" onClick={() => void doCatch()}>
            Catch! ✋
          </Button>
        )}
      </div>

      {/* Table: a felt play surface holding the draw pile + discard + active color */}
      <div
        className="mx-auto mb-5 flex max-w-md items-center justify-center gap-8 rounded-[28px] border border-black/10 px-6 py-6 shadow-e3"
        style={{
          background:
            "radial-gradient(ellipse at 50% 35%, #2f9d5b 0%, #1f7d47 55%, #14663a 100%)",
        }}
      >
        {/* Draw pile — stacked backs for depth, whole stack is the draw button. */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void draw()}
            disabled={!myTurn || busy}
            aria-label={`Draw a card, ${game.drawPileCount} left`}
            className={cx(
              "relative rounded-xl outline-none transition-transform",
              myTurn && !busy
                ? "cursor-pointer hover:-translate-y-1 focus-visible:ring-4 ring-white/80"
                : "cursor-default opacity-90",
            )}
          >
            {/* Offset backs behind the top one to suggest a physical stack. */}
            <span className="absolute left-1 top-1 opacity-70" aria-hidden>
              <UnoCardBack size="lg" />
            </span>
            <span className="absolute left-0.5 top-0.5 opacity-85" aria-hidden>
              <UnoCardBack size="lg" />
            </span>
            <span className="relative">
              <UnoCardBack size="lg" />
            </span>
            {myTurn && !busy && game.pendingDraw === 0 && (
              <motion.span
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#1f7d47] shadow-e2"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                DRAW
              </motion.span>
            )}
          </button>
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold text-white/90">
            {game.drawPileCount} left
          </span>
        </div>

        {/* Discard top with a glow ring in the active color. */}
        <div className="flex flex-col items-center gap-2">
          <motion.div
            key={game.topCard.id}
            initial={{ scale: 0.8, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
            className="rounded-2xl p-1"
            style={{ boxShadow: `0 0 0 4px ${COLOR_HEX[game.activeColor]}, 0 0 24px 2px ${COLOR_HEX[game.activeColor]}88` }}
          >
            <UnoCardView card={game.topCard} size="lg" />
          </motion.div>
          <span className="flex items-center gap-1.5 rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold capitalize text-white/90">
            <span className={cx("inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/60", COLOR_SWATCH[game.activeColor])} aria-hidden />
            {game.activeColor}
          </span>
        </div>
      </div>

      {/* Turn / stack status line */}
      <div className="mb-4 text-center">
        <motion.div
          key={`${game.turn}-${game.pendingDraw}-${game.hasDrawn}`}
          initial={{ opacity: 0, y: -4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={cx(
            "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold shadow-e1",
            game.pendingDraw > 0
              ? "bg-danger/10 text-danger ring-1 ring-danger/30"
              : myTurn
                ? "bg-brand text-white shadow-e2"
                : "bg-surface text-ink-soft",
          )}
        >
          {game.pendingDraw > 0 ? (
            <span>
              Stacked penalty <b>+{game.pendingDraw}</b> —{" "}
              {myTurn ? "stack a matching card or draw the pile" : "waiting on opponent"}
            </span>
          ) : myTurn ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              {game.hasDrawn ? "Play the drawn card or pass" : "Your turn"}
            </span>
          ) : (
            <span>{opponent?.nickname ?? "Opponent"}'s turn…</span>
          )}
        </motion.div>
      </div>

      {/* Your hand — a subtle tray with a label + live count. */}
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface-2/60 px-3 pb-3 pt-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Your hand</span>
          <span className="text-xs font-semibold text-ink-mute">{game.hand.length} cards</span>
        </div>
        <div className="flex flex-wrap items-end justify-center gap-2">
          <AnimatePresence mode="popLayout">
            {game.hand.map((card) => {
              const canPlay = myTurn && playable.has(card.id) && !busy;
              return (
                <UnoCardView
                  key={card.id}
                  card={card}
                  size="md"
                  selectable={canPlay}
                  selected={pendingWild === card.id}
                  dimmed={myTurn && !playable.has(card.id)}
                  onClick={canPlay ? () => void clickCard(card.id, card.kind) : undefined}
                />
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Action row */}
      <div className="mt-5 flex items-center justify-center gap-3">
        {myTurn && game.hasDrawn && game.pendingDraw === 0 && (
          <Button variant="secondary" onClick={() => void pass()} disabled={busy}>
            Pass
          </Button>
        )}
        {shouldOfferUnoCall && (
          <Button variant="primary" onClick={() => void callUno()} className="animate-pulse">
            Call UNO! 🎉
          </Button>
        )}
      </div>

      {/* Wild color picker */}
      <AnimatePresence>
        {pendingWild && (
          <motion.div
            className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPendingWild(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs rounded-2xl border border-border bg-surface p-6 text-center shadow-e5"
            >
              <h3 className="mb-4 font-display text-lg font-bold text-ink">Pick a color</h3>
              <div className="grid grid-cols-2 gap-3">
                {(["red", "yellow", "green", "blue"] as UnoColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => void chooseColor(color)}
                    aria-label={color}
                    className={cx(
                      "h-16 rounded-xl border-2 border-white/70 shadow-e2 outline-none transition-transform hover:scale-105 focus-visible:ring-4 ring-brand",
                      COLOR_SWATCH[color],
                    )}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round / match overlay */}
      <AnimatePresence>
        {roundOver && (
          <UnoRoundOverlay
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

function UnoRoundOverlay({
  game,
  mySeat,
  opponentName,
  matchOver,
  onNextRound,
  onRematch,
}: {
  game: UnoPublicView;
  mySeat: Seat;
  opponentName: string;
  matchOver: boolean;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}) {
  const [readying, setReadying] = useState(false);
  const iWonRound = game.roundWinnerSeat === mySeat;
  const matchWinner = game.matchWinnerSeat;

  let title: string;
  if (matchOver) {
    if (matchWinner === "tie") title = "It's a tie! 🤝";
    else title = matchWinner === mySeat ? "You win the match! 🏆" : "You lost the match";
  } else {
    title = iWonRound ? "You won the round! 🎉" : `${opponentName} went out first`;
  }

  const waitingForOpponent = game.youReady && !game.opponentReady && !matchOver;

  const clickNext = useCallback(async () => {
    if (readying) return;
    setReadying(true);
    const res = await onNextRound();
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

        <div className="mt-6">
          {matchOver ? (
            <Button fullWidth size="lg" onClick={() => void onRematch()}>
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
