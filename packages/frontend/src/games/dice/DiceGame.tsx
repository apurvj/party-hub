import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DICE_CATEGORY_META,
  type DiceOutcome,
  type DicePublicView,
  type DiceSeat,
  type Result,
  type RoomStatePayload,
  type Sex,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";
import { AdultConsentGate, AwaitingPartner, type AdultTheme } from "../adult/consent.js";

interface DiceGameProps {
  room: RoomStatePayload;
  game: DicePublicView;
  onSetSex: (sex: Sex) => Promise<Result<null>>;
  onSpin: () => Promise<Result<null>>;
  onResolve: (outcome: DiceOutcome) => Promise<Result<null>>;
  onSafeword: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

/** Deep, wild rose→oxblood gradient - hotter than Match by design. */
const HEAT_GRADIENT = "linear-gradient(155deg, #b3164a 0%, #7a0f39 55%, #3d0a22 100%)";
const CARD_GRADIENT = "linear-gradient(155deg, #d11f5c 0%, #8f1240 100%)";

function fireHeat() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({
    particleCount: 120,
    spread: 90,
    origin: { y: 0.5 },
    scalar: 1.1,
    colors: ["#d11f5c", "#ff4d7d", "#b3164a", "#ffd0dd", "#7a0f39"],
    disableForReducedMotion: true,
  });
}

export function DiceGame({ room, game, onSetSex, onSpin, onResolve, onSafeword, onRematch }: DiceGameProps) {
  const { show } = useToast();
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const opponentName = opponent?.nickname ?? "your partner";
  const yourSeat = game.yourSeat;

  const [submittingSex, setSubmittingSex] = useState(false);
  // A successful set_sex flips game.yourSex and unmounts the gate while the ack
  // is still resolving; guard the failure-path setState against an unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const over = game.stage === "over" || game.sessionEnded;

  // The safeword ends the set for both. Guard against a panicked double-tap
  // firing several parallel onSafeword() calls (duplicate error toasts / racing
  // dispatches); one in-flight call is enough. The ref (not state) means no
  // re-render and no chance of a stale-closure gap between taps.
  const safewording = useRef(false);
  const triggerSafeword = useCallback(() => {
    if (safewording.current) return;
    safewording.current = true;
    void onSafeword().then((r) => {
      if (!r.ok) {
        show(r.error.message, "warning");
        if (mounted.current) safewording.current = false;
      }
      // On success the set ends and this view is swapped out; leave it latched.
    });
  }, [onSafeword, show]);

  // Fire a celebration when a winner is crowned (not on safeword).
  const celebrated = useRef(false);
  useEffect(() => {
    if (game.stage === "over" && !game.sessionEnded && game.winnerSeat && !celebrated.current) {
      celebrated.current = true;
      fireHeat();
    }
    if (game.stage !== "over") celebrated.current = false;
  }, [game.stage, game.sessionEnded, game.winnerSeat]);

  // GATE 1 - consent + body. Nothing explicit renders until you've declared.
  if (game.yourSex === null) {
    return (
      <AdultConsentGate
        theme={DICE_THEME}
        busy={submittingSex}
        bullets={<DiceConsentBullets />}
        onConfirm={(sex) => {
          setSubmittingSex(true);
          void onSetSex(sex).then((r) => {
            if (!r.ok) {
              show(r.error.message, "danger");
              if (mounted.current) setSubmittingSex(false);
            }
          });
        }}
      />
    );
  }

  // GATE 2 - you're set, but each deck waits until your partner declares too.
  if (game.stage === "setup") {
    return (
      <AwaitingPartner
        theme={DICE_THEME}
        youName={you.nickname}
        opponentName={opponentName}
        opponentConnected={opponent?.connected ?? false}
      />
    );
  }

  const yourScore = yourSeat ? game.scores[yourSeat] : 0;
  const oppScore = yourSeat ? game.scores[yourSeat === "A" ? "B" : "A"] : 0;

  return (
    <div className="relative mx-auto max-w-md pt-2">
      {/* Header: scoreboard */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
        <div className="flex items-center gap-2">
          <PlayerBadge nickname={you.nickname} you connected size="sm" />
          <span className="font-display text-lg font-bold text-[#d11f5c]">{yourScore}</span>
        </div>
        <div className="text-center">
          <div className="font-display text-sm font-bold text-[#d11f5c]">Dare Roulette 🎲</div>
          <div className="text-xs text-ink-mute">first to {game.targetScore}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-bold text-ink-soft">{oppScore}</span>
          <PlayerBadge
            nickname={opponent?.nickname ?? "Waiting…"}
            connected={opponent?.connected ?? false}
            size="sm"
          />
        </div>
      </div>

      {/* Whose turn banner */}
      <div
        className={cx(
          "mb-3 rounded-2xl px-4 py-2.5 text-center text-sm font-semibold",
          game.yourTurn ? "text-white shadow-e2" : "border border-border bg-surface-2 text-ink-soft",
        )}
        style={game.yourTurn ? { background: CARD_GRADIENT } : undefined}
      >
        {game.yourTurn ? (
          <>Your turn, {you.nickname} - spin the roulette 🎲</>
        ) : (
          <>{opponentName}'s turn - sit back and watch 👀</>
        )}
      </div>

      {/* Stage body */}
      {game.stage === "rolling" ? (
        <RollStage
          yourTurn={game.yourTurn}
          opponentName={opponentName}
          turnNumber={game.turnNumber}
          onSpin={onSpin}
          onError={(m) => show(m, "warning")}
        />
      ) : game.stage === "resolving" && game.current ? (
        <ResolveStage
          key={`${game.current.card.id}#${game.turnNumber}`}
          game={game}
          youName={you.nickname}
          opponentName={opponentName}
          onResolve={onResolve}
          onError={(m) => show(m, "warning")}
        />
      ) : (
        <div className="min-h-[300px]" />
      )}

      {/* Recent history */}
      {game.history.length > 0 && !over && <HistoryStrip game={game} />}

      {/* Discreet, always-available safeword */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={triggerSafeword}
          className="text-xs font-medium text-ink-mute underline decoration-dotted underline-offset-4 transition-colors hover:text-danger"
        >
          Safeword - end the set for both of us
        </button>
      </div>

      {/* Game-over overlay */}
      <AnimatePresence>
        {over && (
          <GameOverOverlay
            game={game}
            youName={you.nickname}
            opponentName={opponentName}
            yourSeat={yourSeat}
            onRematch={onRematch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- roll stage -------------------------------------------------------------

function RollStage({
  yourTurn,
  opponentName,
  turnNumber,
  onSpin,
  onError,
}: {
  yourTurn: boolean;
  opponentName: string;
  turnNumber: number;
  onSpin: () => Promise<Result<null>>;
  onError: (msg: string) => void;
}) {
  const [spinning, setSpinning] = useState(false);
  // Guards a setState after the component has unmounted (the successful ack
  // remounts us into the resolve stage while a spin is still in flight).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const spin = async () => {
    if (spinning) return;
    setSpinning(true);
    // Await the server ack: on success the parent remounts us into the resolve
    // stage; on rejection we must re-enable immediately so the turn isn't stuck.
    const res = await onSpin();
    if (!res.ok) {
      onError(res.error.message);
      if (mounted.current) setSpinning(false);
    }
  };

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[28px] border border-border bg-surface-2/60 p-8 text-center">
      <motion.button
        type="button"
        onClick={yourTurn ? () => void spin() : undefined}
        disabled={!yourTurn || spinning}
        whileTap={yourTurn ? { scale: 0.9 } : undefined}
        animate={spinning ? { rotate: [0, 90, 180, 270, 360] } : { rotate: 0 }}
        transition={spinning ? { duration: 0.8, ease: "easeInOut" } : { duration: 0.2 }}
        aria-label="Spin the roulette"
        className={cx(
          "grid h-28 w-28 place-items-center rounded-3xl text-6xl shadow-e5 outline-none transition-transform focus-visible:ring-4 focus-visible:ring-[#d11f5c]/40",
          yourTurn ? "cursor-pointer text-white" : "cursor-default opacity-70",
        )}
        style={{ background: HEAT_GRADIENT }}
      >
        🎲
      </motion.button>
      <h3 className="mt-5 font-display text-xl font-bold text-ink">
        {yourTurn ? "Tap to spin" : `${opponentName} is up`}
      </h3>
      <p className="mt-2 max-w-xs text-sm text-ink-soft">
        {yourTurn
          ? "Draw a dare and roll the heat die. Whatever it lands on is yours to do - for points."
          : `Waiting for ${opponentName} to spin the roulette…`}
      </p>
      <p className="mt-3 text-xs text-ink-mute">Turn {turnNumber}</p>
    </div>
  );
}

// ---- resolve stage ----------------------------------------------------------

function ResolveStage({
  game,
  youName,
  opponentName,
  onResolve,
  onError,
}: {
  game: DicePublicView;
  youName: string;
  opponentName: string;
  onResolve: (outcome: DiceOutcome) => Promise<Result<null>>;
  onError: (msg: string) => void;
}) {
  const draw = game.current!;
  const cat = DICE_CATEGORY_META[draw.card.category];
  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<DiceOutcome | null>(null);

  const commit = useCallback(
    async (outcome: DiceOutcome) => {
      if (busy) return;
      setBusy(true);
      setExit(outcome);
      const res = await onResolve(outcome);
      if (!res.ok) {
        onError(res.error.message);
        setBusy(false);
        setExit(null);
      }
      // On success the parent remounts (keyed) into the next turn.
    },
    [busy, onResolve, onError],
  );

  return (
    <div>
      <div className="relative min-h-[320px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 translate-x-1.5 translate-y-2 rounded-[28px] bg-surface-2 opacity-60 shadow-e1"
        />
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 14 }}
          animate={
            exit === "done"
              ? { x: 480, opacity: 0, rotate: 12 }
              : exit === "pass"
                ? { x: -480, opacity: 0, rotate: -12 }
                : { scale: 1, opacity: 1, y: 0 }
          }
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="relative flex min-h-[320px] flex-col justify-between rounded-[28px] p-6 text-white shadow-e5"
          style={{ background: CARD_GRADIENT }}
        >
          {/* Top row: category + heat die */}
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wide">
              {cat.emoji} {cat.label}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-xs font-bold">
              <span className="text-base">{draw.face.emoji}</span>
              {draw.face.label} · +{draw.face.points}
            </span>
          </div>

          <p className="my-3 text-center font-display text-2xl font-bold leading-snug drop-shadow">
            {draw.card.text}
          </p>

          {/* Heat modifier callout */}
          <div className="rounded-2xl bg-black/25 px-4 py-3 text-center">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/70">
              Heat roll - {draw.face.emoji} {draw.face.label}
            </div>
            <div className="mt-1 text-sm font-medium leading-snug text-white/95">{draw.face.modifier}</div>
          </div>

          {draw.card.media && (
            <div className="mt-3 text-center text-xs font-medium text-white/80">📷 involves media</div>
          )}
        </motion.div>
      </div>

      {/* Controls - only the performer (current turn) acts */}
      {game.yourTurn ? (
        <>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => void commit("pass")}>
              Pass
            </Button>
            <Button size="lg" loading={busy && exit === "done"} disabled={busy} onClick={() => void commit("done")}>
              Did it ✓ +{draw.face.points}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-ink-mute">
            Passing is always okay - you just don't score. Then it's {opponentName}'s turn.
          </p>
        </>
      ) : (
        <p className="mt-5 text-center text-sm text-ink-soft">
          {youName === opponentName ? "Watching…" : `${opponentName} is doing this one - cheer them on 🔥`}
        </p>
      )}
    </div>
  );
}

// ---- history strip ----------------------------------------------------------

function HistoryStrip({ game }: { game: DicePublicView }) {
  const recent = game.history.slice(-3).reverse();
  return (
    <ul className="mt-5 space-y-1.5">
      {recent.map((h, i) => (
        <li
          key={`${h.card.id}#${game.history.length - i}`}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-3 py-2 text-xs"
        >
          <span aria-hidden>{DICE_CATEGORY_META[h.card.category].emoji}</span>
          <span className="flex-1 truncate text-ink-soft">{h.card.text}</span>
          <span
            className={cx("shrink-0 font-bold", h.outcome === "done" ? "text-[#d11f5c]" : "text-ink-mute")}
          >
            {h.outcome === "done" ? `+${h.scored}` : "pass"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- game over --------------------------------------------------------------

function GameOverOverlay({
  game,
  youName,
  opponentName,
  yourSeat,
  onRematch,
}: {
  game: DicePublicView;
  youName: string;
  opponentName: string;
  yourSeat: DiceSeat | null;
  onRematch: () => Promise<Result<null>>;
}) {
  const { show } = useToast();
  const ended = game.sessionEnded;
  const youWon = !ended && yourSeat !== null && game.winnerSeat === yourSeat;
  const winnerName = game.winnerSeat === yourSeat ? youName : opponentName;

  const doneCount = game.history.filter((h) => h.outcome === "done").length;

  // A successful rematch swaps this overlay out from under us; guard the
  // failure-path setState against an unmount, and block a double-tap from
  // dispatching two rematches.
  const [readying, setReadying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const clickRematch = useCallback(async () => {
    if (readying) return;
    setReadying(true);
    const res = await onRematch();
    if (!res.ok) {
      show(res.error.message, "warning");
      if (mounted.current) setReadying(false);
    }
  }, [readying, onRematch, show]);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(4px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dice-over-title"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-surface p-7 shadow-e5"
      >
        <div className="text-center">
          <div className="mb-2 text-4xl">{ended ? "🫶" : youWon ? "🏆" : "🔥"}</div>
          <h2 id="dice-over-title" className="font-display text-2xl font-bold text-ink">
            {ended ? "Session ended" : youWon ? "You won!" : `${winnerName} wins`}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {ended
              ? "No hard feelings - start a fresh set whenever you're ready."
              : `Final score ${game.scores.A}–${game.scores.B}. ${doneCount} ${doneCount === 1 ? "dare" : "dares"} conquered together 🔥`}
          </p>
        </div>

        {game.history.length > 0 && (
          <ul className="mt-5 flex-1 space-y-2 overflow-y-auto pr-1">
            {game.history.map((h, i) => (
              <li
                key={`${h.card.id}#${i}`}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3"
              >
                <span
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm"
                  style={{ background: CARD_GRADIENT }}
                  aria-hidden
                >
                  {DICE_CATEGORY_META[h.card.category].emoji}
                </span>
                <span className="flex-1 text-sm leading-snug text-ink">{h.card.text}</span>
                <span
                  className={cx(
                    "mt-0.5 shrink-0 text-xs font-bold",
                    h.outcome === "done" ? "text-[#d11f5c]" : "text-ink-mute",
                  )}
                >
                  {h.outcome === "done" ? `+${h.scored}` : "pass"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <Button fullWidth size="lg" loading={readying} onClick={() => void clickRematch()}>
            {ended ? "Start a new set" : "Play again →"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---- consent gate -----------------------------------------------------------

const DICE_THEME: AdultTheme = {
  headerGradient: HEAT_GRADIENT,
  accent: "#d11f5c",
  emoji: "🎲",
  title: "Dare Roulette",
  tagline: "Wild-only dares for you and your partner",
  cta: "Let's roll →",
};

function DiceConsentBullets() {
  return (
    <>
      <li className="flex gap-2">
        <span aria-hidden>🎲</span>
        <span>
          On your turn you <b>spin a dare</b> and <b>roll a heat die</b> that dials it up. Do it to
          score; first to the target wins.
        </span>
      </li>
      <li className="flex gap-2">
        <span aria-hidden>🛟</span>
        <span>
          <b>Pass</b> any dare with no penalty, or hit the <b>safeword</b> to end the set instantly -
          no questions asked.
        </span>
      </li>
      <li className="flex gap-2">
        <span aria-hidden>🔞</span>
        <span>
          This deck is <b>explicit and wild only</b> - kink, BDSM, and more - for consenting adults
          (18+).
        </span>
      </li>
    </>
  );
}
