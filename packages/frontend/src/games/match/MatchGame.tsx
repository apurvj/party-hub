import confetti from "canvas-confetti";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MATCH_TIER_META,
  type MatchCard,
  type MatchCategory,
  type MatchDare,
  type MatchDareOutcome,
  type MatchPublicView,
  type MatchVote,
  type Result,
  type RoomStatePayload,
  type Sex,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";
import { AdultConsentGate, AwaitingPartner, type AdultTheme } from "../adult/consent.js";

interface MatchGameProps {
  room: RoomStatePayload;
  game: MatchPublicView;
  onSetSex: (sex: Sex) => Promise<Result<null>>;
  onVote: (cardId: string, vote: MatchVote) => Promise<Result<null>>;
  onDareAdvance: (outcome: MatchDareOutcome) => Promise<Result<null>>;
  onSafeword: () => Promise<Result<null>>;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

const CATEGORY_META: Record<MatchCategory, { label: string; emoji: string }> = {
  romance: { label: "Sensual", emoji: "💗" },
  foreplay: { label: "Foreplay", emoji: "🔥" },
  oral: { label: "Oral", emoji: "👄" },
  positions: { label: "Position", emoji: "🧎" },
  tempo: { label: "Tempo", emoji: "⏱️" },
  toys: { label: "Toys & more", emoji: "🥒" },
  roleplay: { label: "Power play", emoji: "⛓️" },
  messages: { label: "Send it", emoji: "📱" },
};

/** Rose gradient per tier - hotter tiers read warmer/darker. */
const TIER_GRADIENT: Record<string, string> = {
  sweet: "linear-gradient(150deg, #ff8fb1 0%, #ff6f91 100%)",
  flirty: "linear-gradient(150deg, #ff6f91 0%, #f0487f 100%)",
  spicy: "linear-gradient(150deg, #f0487f 0%, #c81e5b 100%)",
  wild: "linear-gradient(150deg, #b3164a 0%, #6d0f36 100%)",
};

function fireHearts() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.55 },
    scalar: 1.2,
    shapes: ["circle"],
    colors: ["#ff6f91", "#ff8fb1", "#f0487f", "#ffd0dd"],
    disableForReducedMotion: true,
  });
}

export function MatchGame({
  room,
  game,
  onSetSex,
  onVote,
  onDareAdvance,
  onSafeword,
  onNextRound,
  onRematch,
}: MatchGameProps) {
  const { show } = useToast();
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const opponentName = opponent?.nickname ?? "your partner";

  // Have you declared a body yet? That single authoritative flag (from the
  // server) drives BOTH gates: null → show the consent + body gate; declared but
  // still in setup → wait for your partner to declare too.
  const [submittingSex, setSubmittingSex] = useState(false);
  // A successful set_sex flips game.yourSex and unmounts the gate while the ack
  // is still resolving; guard the failure-path setState so it never fires on an
  // unmounted component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isVoting = game.stage === "voting";
  const isDares = game.stage === "dares";
  // The reveal wraps up the round: the summary stage, or an early safeword.
  const showReveal = game.stage === "summary" || game.sessionEnded;

  // Celebrate each NEW mutual match as it lands (Tinder-style "It's a match!").
  // Only during voting - the dares stage has its own turn-taking celebration.
  const prevMatchCount = useRef(game.matches.length);
  const [flash, setFlash] = useState<MatchCard | null>(null);
  useEffect(() => {
    if (isVoting && game.matches.length > prevMatchCount.current) {
      const newest = game.matches[game.matches.length - 1]?.card ?? null;
      if (newest) {
        setFlash(newest);
        fireHearts();
        const t = window.setTimeout(() => setFlash(null), 2200);
        prevMatchCount.current = game.matches.length;
        return () => window.clearTimeout(t);
      }
    }
    prevMatchCount.current = game.matches.length;
  }, [game.matches, isVoting]);

  const safeword = (
    <div className="mt-6 text-center">
      <button
        type="button"
        onClick={() => void onSafeword().then((r) => !r.ok && show(r.error.message, "warning"))}
        className="text-xs font-medium text-ink-mute underline decoration-dotted underline-offset-4 transition-colors hover:text-danger"
      >
        Safeword - end the session for both of us
      </button>
    </div>
  );

  // GATE 1 - consent + body. Until you've declared, no explicit content renders.
  if (game.yourSex === null) {
    return (
      <AdultConsentGate
        theme={MATCH_THEME}
        busy={submittingSex}
        bullets={<MatchConsentBullets opponentName={opponentName} />}
        onConfirm={(sex) => {
          setSubmittingSex(true);
          void onSetSex(sex).then((r) => {
            // On success the server flips game.yourSex and this gate unmounts;
            // on failure re-enable so they can retry (only if still mounted).
            if (!r.ok) {
              show(r.error.message, "danger");
              if (mounted.current) setSubmittingSex(false);
            }
          });
        }}
      />
    );
  }

  // GATE 2 - you're in, but the deck isn't built until your partner declares too.
  if (game.stage === "setup") {
    return (
      <AwaitingPartner
        theme={MATCH_THEME}
        youName={you.nickname}
        opponentName={opponentName}
        opponentConnected={opponent?.connected ?? false}
      />
    );
  }

  return (
    <div className="relative mx-auto max-w-md pt-2">
      {isDares ? (
        <>
          <DaresStage
            game={game}
            youName={you.nickname}
            opponentName={opponentName}
            onDareAdvance={onDareAdvance}
            onError={(m) => show(m, "warning")}
          />
          {safeword}
        </>
      ) : (
        <>
          {/* Header: progress + safeword */}
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
            <div className="flex items-center gap-2">
              <PlayerBadge nickname={you.nickname} you connected size="sm" />
              <span className="text-sm text-ink-soft">
                <span className="font-semibold text-ink">{game.youVotedCount}</span>/{game.deckSize}
              </span>
            </div>
            <div className="text-center">
              <div className="font-display text-sm font-bold text-[#f0487f]">Match 💞</div>
              <div className="text-xs text-ink-mute">
                {game.matches.length} {game.matches.length === 1 ? "match" : "matches"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-soft">
                <span className="font-semibold text-ink">{game.opponentVotedCount}</span>/{game.deckSize}
              </span>
              <PlayerBadge
                nickname={opponent?.nickname ?? "Waiting…"}
                connected={opponent?.connected ?? false}
                size="sm"
              />
            </div>
          </div>

          {/* Card area */}
          {!game.youFinished && game.currentCard ? (
            <SwipeDeck
              key={game.currentCard.id}
              card={game.currentCard}
              onVote={onVote}
              onError={(m) => show(m, "warning")}
            />
          ) : (
            <WaitingForPartner
              youFinished={game.youFinished}
              bothFinished={game.youFinished && game.opponentFinished}
              opponentName={opponentName}
              matchCount={game.matches.length}
            />
          )}

          {safeword}
        </>
      )}

      {/* "It's a match!" flash */}
      <AnimatePresence>
        {flash && <MatchFlash card={flash} onClose={() => setFlash(null)} />}
      </AnimatePresence>

      {/* Round-over / session-over reveal */}
      <AnimatePresence>
        {showReveal && (
          <RevealOverlay
            game={game}
            opponentName={opponentName}
            onNextRound={onNextRound}
            onRematch={onRematch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- swipe deck -------------------------------------------------------------

const SWIPE_THRESHOLD = 110;

function SwipeDeck({
  card,
  onVote,
  onError,
}: {
  card: MatchCard;
  onVote: (cardId: string, vote: MatchVote) => Promise<Result<null>>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<MatchVote | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Rotate slightly with horizontal drag; fade decision labels in per direction.
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const yesOpacity = useTransform(x, [30, 130], [0, 1]);
  const noOpacity = useTransform(x, [-130, -30], [1, 0]);
  const maybeOpacity = useTransform(y, [-130, -30], [1, 0]);

  const tier = MATCH_TIER_META[card.tier];
  const cat = CATEGORY_META[card.category];

  const commit = useCallback(
    async (vote: MatchVote) => {
      if (busy) return;
      setBusy(true);
      setExit(vote);
      const res = await onVote(card.id, vote);
      if (!res.ok) {
        onError(res.error.message);
        setBusy(false);
        setExit(null);
      }
      // On success the parent remounts with the next card (keyed by id).
    },
    [busy, card.id, onVote, onError],
  );

  const exitTarget =
    exit === "yes"
      ? { x: 500, opacity: 0, rotate: 18 }
      : exit === "no"
        ? { x: -500, opacity: 0, rotate: -18 }
        : exit === "maybe"
          ? { y: -500, opacity: 0 }
          : { opacity: 0 };

  return (
    <div>
      {/* Card stage - the backing card + swipe card live here so the absolute
          backing layer can never overlap (and block taps on) the buttons. */}
      <div className="relative min-h-[340px]">
        {/* A backing card for physical depth. Must not intercept pointer events. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 translate-x-1.5 translate-y-2 rounded-[28px] bg-surface-2 opacity-60 shadow-e1"
        />

        <motion.div
          drag={!busy}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={0.7}
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={exit ? exitTarget : { scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onDragEnd={(_e, info) => {
            if (busy) return;
            if (info.offset.x > SWIPE_THRESHOLD) void commit("yes");
            else if (info.offset.x < -SWIPE_THRESHOLD) void commit("no");
            else if (info.offset.y < -SWIPE_THRESHOLD) void commit("maybe");
          }}
          className="relative flex min-h-[340px] cursor-grab flex-col justify-between rounded-[28px] p-6 text-white shadow-e5 active:cursor-grabbing"
          style={{ x, y, rotate, background: TIER_GRADIENT[card.tier] }}
        >
        {/* Decision labels that fade in as you drag */}
        <motion.span
          style={{ opacity: yesOpacity }}
          className="pointer-events-none absolute left-5 top-5 -rotate-12 rounded-lg border-4 border-white px-3 py-1 font-display text-2xl font-black tracking-wide"
        >
          YES
        </motion.span>
        <motion.span
          style={{ opacity: noOpacity }}
          className="pointer-events-none absolute right-5 top-5 rotate-12 rounded-lg border-4 border-white px-3 py-1 font-display text-2xl font-black tracking-wide"
        >
          NOPE
        </motion.span>
        <motion.span
          style={{ opacity: maybeOpacity }}
          className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border-4 border-white px-3 py-1 font-display text-xl font-black tracking-wide"
        >
          MAYBE
        </motion.span>

        <div className="flex items-center justify-between">
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wide">
            {tier.emoji} {tier.label}
          </span>
          {card.media && (
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
              📷 media
            </span>
          )}
        </div>

        <p className="my-auto py-4 text-center font-display text-2xl font-bold leading-snug drop-shadow">
          {card.text}
        </p>

        <div className="text-center text-xs font-medium text-white/80">
          {cat.emoji} {cat.label}
        </div>
        </motion.div>
      </div>

      {/* Explicit buttons (accessibility + non-drag devices) */}
      <div className="mt-5 flex items-center justify-center gap-4">
        <VoteButton label="Nope" emoji="👎" tone="no" onClick={() => void commit("no")} disabled={busy} />
        <VoteButton label="Maybe" emoji="🤔" tone="maybe" onClick={() => void commit("maybe")} disabled={busy} />
        <VoteButton label="Yes" emoji="❤️" tone="yes" onClick={() => void commit("yes")} disabled={busy} />
      </div>
      <p className="mt-3 text-center text-xs text-ink-mute">
        Swipe or tap - your answers stay private. Only mutual yeses are revealed.
      </p>
    </div>
  );
}

function VoteButton({
  label,
  emoji,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  emoji: string;
  tone: "yes" | "no" | "maybe";
  onClick: () => void;
  disabled?: boolean;
}) {
  const ring =
    tone === "yes"
      ? "ring-[#f0487f]/40 hover:border-[#f0487f]"
      : tone === "no"
        ? "ring-ink-mute/30 hover:border-ink-mute"
        : "ring-warning/40 hover:border-warning";
  const big = tone !== "maybe";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      className={cx(
        "grid place-items-center rounded-full border border-border bg-surface shadow-e2 outline-none transition-all focus-visible:ring-4 disabled:opacity-50",
        big ? "h-16 w-16 text-2xl" : "h-12 w-12 text-xl",
        ring,
      )}
    >
      {emoji}
    </motion.button>
  );
}

// ---- dares play-out ---------------------------------------------------------

/**
 * The turn-based play-out. Both partners matched on these cards; now they take
 * turns being the performer. The server assigns each dare a performer (strict
 * alternation, seeded start) - here we simply render whose turn it is and, when
 * it's yours, let you mark it done or skip and pass the turn. The dare TEXT is
 * mutually consented, so both partners see it; only the "who acts" differs.
 */
function DaresStage({
  game,
  youName,
  opponentName,
  onDareAdvance,
  onError,
}: {
  game: MatchPublicView;
  youName: string;
  opponentName: string;
  onDareAdvance: (outcome: MatchDareOutcome) => Promise<Result<null>>;
  onError: (msg: string) => void;
}) {
  const total = game.dares.length;
  const dare = game.currentDare;
  const performerName = dare ? (game.yourTurn ? youName : opponentName) : "";

  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<MatchDareOutcome | null>(null);

  const commit = useCallback(
    async (outcome: MatchDareOutcome) => {
      if (busy) return;
      setBusy(true);
      setExit(outcome);
      const res = await onDareAdvance(outcome);
      if (!res.ok) onError(res.error.message);
      // On success the parent rerenders with the next dare (keyed below);
      // reset either way so a rejected action re-enables the buttons.
      setBusy(false);
      setExit(null);
    },
    [busy, onDareAdvance, onError],
  );

  if (!dare) {
    // Between the last resolve and the summary render - brief, no card to show.
    return (
      <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[28px] border border-border bg-surface-2/60 p-8 text-center">
        <div className="mb-3 text-5xl">💞</div>
        <h3 className="font-display text-xl font-bold text-ink">Wrapping up…</h3>
      </div>
    );
  }

  const tier = MATCH_TIER_META[dare.card.tier];
  const cat = CATEGORY_META[dare.card.category];

  return (
    <div>
      {/* Header: play-out progress */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
        <div>
          <div className="font-display text-sm font-bold text-[#f0487f]">Play it out 🔥</div>
          <div className="text-xs text-ink-mute">
            Dare {Math.min(game.daresResolved + 1, total)} of {total}
          </div>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          {game.dares.map((d, i) => (
            <span
              key={d.card.id}
              className={cx(
                "h-2 w-2 rounded-full",
                i < game.daresResolved
                  ? "bg-[#f0487f]"
                  : i === game.daresResolved
                    ? "bg-[#f0487f]/50 ring-2 ring-[#f0487f]/40"
                    : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      {/* Whose turn banner */}
      <div
        className={cx(
          "mb-3 rounded-2xl px-4 py-2.5 text-center text-sm font-semibold",
          game.yourTurn ? "bg-[#f0487f] text-white shadow-e2" : "border border-border bg-surface-2 text-ink-soft",
        )}
      >
        {game.yourTurn ? (
          <>Your turn, {youName} - for {opponentName} 💋</>
        ) : (
          <>{opponentName}'s turn - you get to watch 👀</>
        )}
      </div>

      {/* The dare card */}
      <div className="relative min-h-[300px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 translate-x-1.5 translate-y-2 rounded-[28px] bg-surface-2 opacity-60 shadow-e1"
        />
        <motion.div
          key={dare.card.id}
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={
            exit === "done"
              ? { x: 500, opacity: 0, rotate: 12 }
              : exit === "skip"
                ? { x: -500, opacity: 0, rotate: -12 }
                : { scale: 1, opacity: 1, y: 0 }
          }
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="relative flex min-h-[300px] flex-col justify-between rounded-[28px] p-6 text-white shadow-e5"
          style={{ background: TIER_GRADIENT[dare.card.tier] }}
        >
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wide">
              {tier.emoji} {tier.label}
            </span>
            {dare.card.media && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">📷 media</span>
            )}
          </div>

          <p className="my-auto py-4 text-center font-display text-2xl font-bold leading-snug drop-shadow">
            {dare.card.text}
          </p>

          <div className="text-center text-xs font-medium text-white/80">
            {cat.emoji} {cat.label} · {performerName}'s to do
          </div>
        </motion.div>
      </div>

      {/* Controls - only the performer can act */}
      {game.yourTurn ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => void commit("skip")}>
            Skip
          </Button>
          <Button size="lg" loading={busy && exit === "done"} disabled={busy} onClick={() => void commit("done")}>
            Done ✓ - pass to {opponentName}
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-center text-sm text-ink-soft">
          Waiting for {opponentName} to finish their dare and pass the turn…
        </p>
      )}
    </div>
  );
}

// ---- waiting / reveal -------------------------------------------------------

function WaitingForPartner({
  youFinished,
  bothFinished,
  opponentName,
  matchCount,
}: {
  youFinished: boolean;
  bothFinished: boolean;
  opponentName: string;
  matchCount: number;
}) {
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[28px] border border-border bg-surface-2/60 p-8 text-center">
      <div className="mb-3 text-5xl">{bothFinished ? "💞" : youFinished ? "⏳" : "💗"}</div>
      <h3 className="font-display text-xl font-bold text-ink">
        {bothFinished
          ? "You've both finished the deck"
          : youFinished
            ? `Waiting for ${opponentName}…`
            : "Keep swiping"}
      </h3>
      <p className="mt-2 max-w-xs text-sm text-ink-soft">
        {bothFinished
          ? `You matched on ${matchCount} ${matchCount === 1 ? "idea" : "ideas"}.`
          : youFinished
            ? "You're done! Your matches will be revealed once they finish too."
            : "Rate every card to see what you both said yes to."}
      </p>
    </div>
  );
}

function MatchFlash({ card, onClose }: { card: MatchCard; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 22 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-3xl p-7 text-center text-white shadow-e5"
        style={{ background: TIER_GRADIENT[card.tier] }}
      >
        <div className="mb-2 text-4xl">💞</div>
        <h2 className="font-display text-2xl font-black tracking-tight">It's a match!</h2>
        <p className="mt-3 text-sm font-medium leading-snug text-white/95">{card.text}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-full bg-white/25 px-5 py-2 text-sm font-bold outline-none transition-colors hover:bg-white/35"
        >
          Keep going →
        </button>
      </motion.div>
    </motion.div>
  );
}

function RevealOverlay({
  game,
  opponentName,
  onNextRound,
  onRematch,
}: {
  game: MatchPublicView;
  opponentName: string;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}) {
  const { show } = useToast();
  const [readying, setReadying] = useState(false);
  const ended = game.sessionEnded;
  const waitingForOpponent = game.youReady && !game.opponentReady && !ended;

  // After a full play-out we have per-dare outcomes to recap; a safeword ends
  // things before that, so fall back to the plain matched list.
  const recap: MatchDare[] =
    game.dares.length > 0
      ? game.dares
      : game.matches.map((m) => ({ card: m.card, performerSeat: "A", outcome: null }));
  const doneCount = game.dares.filter((d) => d.outcome === "done").length;

  const clickNext = useCallback(async () => {
    if (readying) return;
    setReadying(true);
    const res = await onNextRound();
    if (!res.ok) {
      show(res.error.message, "warning");
      setReadying(false);
    }
  }, [readying, onNextRound, show]);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
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
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-surface p-7 shadow-e5"
      >
        <div className="text-center">
          <div className="mb-2 text-4xl">{ended ? "🫶" : "💞"}</div>
          <h2 className="font-display text-2xl font-bold text-ink">
            {ended ? "Session ended" : "That's a wrap 🔥"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {recap.length > 0
              ? ended
                ? `You matched on ${recap.length} ${recap.length === 1 ? "idea" : "ideas"} this round.`
                : `You played out ${doneCount} of ${recap.length} ${recap.length === 1 ? "dare" : "dares"} 🔥`
              : ended
                ? "No hard feelings - you can start a fresh deck anytime."
                : "No mutual matches this round - try another deck!"}
          </p>
        </div>

        {recap.length > 0 && (
          <ul className="mt-5 flex-1 space-y-2 overflow-y-auto pr-1">
            {recap.map((d) => (
              <li
                key={d.card.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3"
              >
                <span
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm"
                  style={{ background: TIER_GRADIENT[d.card.tier] }}
                  aria-hidden
                >
                  {MATCH_TIER_META[d.card.tier].emoji}
                </span>
                <span className="flex-1 text-sm leading-snug text-ink">{d.card.text}</span>
                {d.outcome && (
                  <span
                    className={cx(
                      "mt-0.5 shrink-0 text-xs font-bold",
                      d.outcome === "done" ? "text-[#f0487f]" : "text-ink-mute",
                    )}
                    title={d.outcome === "done" ? "Done" : "Skipped"}
                  >
                    {d.outcome === "done" ? "✓ done" : "· skipped"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          {ended ? (
            <Button fullWidth size="lg" onClick={() => void onRematch()}>
              Start a new session
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
              {game.opponentReady ? `${opponentName} is ready - New deck →` : "New deck →"}
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---- consent gate -----------------------------------------------------------

const MATCH_THEME: AdultTheme = {
  headerGradient: TIER_GRADIENT.spicy!,
  accent: "#f0487f",
  emoji: "💞",
  title: "Match",
  tagline: "A private game of desires for you and your partner",
  cta: "Start playing →",
};

function MatchConsentBullets({ opponentName }: { opponentName: string }) {
  return (
    <>
      <li className="flex gap-2">
        <span aria-hidden>🔒</span>
        <span>
          Your yes/maybe/no stays <b>completely private</b>. Only ideas you <i>both</i> say yes to
          are ever revealed.
        </span>
      </li>
      <li className="flex gap-2">
        <span aria-hidden>🛟</span>
        <span>
          Either of you can hit the <b>safeword</b> at any time to end the session with {opponentName} -
          no questions asked.
        </span>
      </li>
      <li className="flex gap-2">
        <span aria-hidden>🔞</span>
        <span>This game is explicit and for consenting adults (18+) only.</span>
      </li>
    </>
  );
}
