import confetti from "canvas-confetti";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  QUESTION_SECTIONS,
  getPerson,
  type GameEvent,
  type GuessWhoPublicView,
  type Person,
  type QuestionSection,
  type Result,
  type RoomStatePayload,
  type Seat,
} from "@party-hub/shared";
import { Button, PlayerBadge, cx, useToast } from "../../design-system/index.js";
import { FaceAvatar } from "./FaceAvatar.js";

interface GuessWhoGameProps {
  room: RoomStatePayload;
  game: GuessWhoPublicView;
  lastEvent: { seq: number; event: GameEvent } | null;
  onChoose: (personId: string) => Promise<Result<null>>;
  onAsk: (section: QuestionSection, value: string) => Promise<Result<null>>;
  onGuess: (personId: string) => Promise<Result<null>>;
  onPass: () => Promise<Result<null>>;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}

function fireConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, disableForReducedMotion: true });
}

export function GuessWhoGame({
  room,
  game,
  lastEvent,
  onChoose,
  onAsk,
  onGuess,
  onPass,
  onNextRound,
  onRematch,
}: GuessWhoGameProps) {
  const { show } = useToast();
  const reduceMotion = useReducedMotion();
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;
  const opponentName = opponent?.nickname ?? "Opponent";
  const mySeat = (room.yourSeat ?? "A") as Seat;

  const roundOver = game.roundWinnerSeat !== null;
  const matchOver = game.matchWinnerSeat !== null;

  const remaining = useMemo(() => new Set(game.remainingPersonIds), [game.remainingPersonIds]);
  const yourPerson = getPerson(game.yourPersonId) ?? null;
  const alreadyGuessed = game.yourGuess !== null;
  const yourTurn = game.isYourTurn;
  const mustGuess = game.mustGuess; // opponent locked you in - guessing is your only move
  // You've narrowed the board to a single face. Because signatures are unique and
  // your target always survives, that lone survivor is provably the answer - so
  // the turn stays with you to finish: guess the sure thing or pass it back.
  const solved = game.solved;
  const soloCandidate =
    solved && game.remainingPersonIds[0] ? getPerson(game.remainingPersonIds[0]) ?? null : null;

  // Guess flow: arm "pick a face", hold the pending choice for a confirm step.
  const [guessMode, setGuessMode] = useState(false);
  const [pendingGuess, setPendingGuess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Being forced to guess (opponent committed) arms guess mode automatically.
  useEffect(() => {
    if (mustGuess) setGuessMode(true);
  }, [mustGuess]);
  // Reset transient UI when the round turns over under us.
  useEffect(() => {
    if (roundOver || alreadyGuessed) {
      setGuessMode(false);
      setPendingGuess(null);
    }
  }, [roundOver, alreadyGuessed, game.roundNumber]);

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

  const ask = useCallback(
    async (section: QuestionSection, value: string) => {
      if (busy) return;
      setBusy(true);
      const res = await onAsk(section, value);
      setBusy(false);
      if (!res.ok) show(res.error.message, "warning");
    },
    [busy, onAsk, show],
  );

  // You may only lock in a guess on your own turn (or when forced to guess, which
  // always coincides with your turn on the server).
  const canGuessNow = yourTurn && !alreadyGuessed && !roundOver;
  const clickFace = useCallback(
    (person: Person) => {
      if (!guessMode || !canGuessNow) return;
      if (!remaining.has(person.id)) return; // can't name an eliminated face
      setPendingGuess(person.id);
    },
    [guessMode, canGuessNow, remaining],
  );

  const confirmGuess = useCallback(async () => {
    if (!pendingGuess || busy) return;
    setBusy(true);
    const res = await onGuess(pendingGuess);
    setBusy(false);
    if (!res.ok) {
      show(res.error.message, "warning");
      setPendingGuess(null);
    }
    // On success the round view updates; effects clear guess mode.
  }, [pendingGuess, busy, onGuess, show]);

  // End your turn WITHOUT guessing - only offered once you've solved the board.
  // Hands the turn back to your opponent so you can hold your one guess in reserve.
  const passTurn = useCallback(async () => {
    if (busy || !solved) return;
    setBusy(true);
    const res = await onPass();
    setBusy(false);
    if (!res.ok) show(res.error.message, "warning");
    // On success the server flips the turn away; the view updates and this panel
    // disappears (it's no longer your turn).
  }, [busy, solved, onPass, show]);

  const myScore = mySeat === "A" ? game.scores.A : game.scores.B;
  const oppScore = mySeat === "A" ? game.scores.B : game.scores.A;
  const remainingCount = game.remainingPersonIds.length;

  // Status line under the scoreboard - mirrors where the player is in the round.
  // Turn-based: only one player acts at a time, and once someone guesses the
  // other is forced into their one final guess.
  let status: { text: string; tone: "you" | "wait" | "lock" | "done" };
  if (mustGuess) {
    status = { text: `${opponentName} locked in their guess! Take your one final shot now.`, tone: "lock" };
  } else if (alreadyGuessed) {
    status = game.opponentGuessed
      ? { text: "Both guesses are in - revealing…", tone: "done" }
      : { text: `Guess locked in. Waiting for ${opponentName} to guess…`, tone: "wait" };
  } else if (!yourTurn) {
    status = { text: `${opponentName}'s turn - hang tight while they make their move.`, tone: "wait" };
  } else if (solved) {
    status = {
      text: soloCandidate ? `Only ${soloCandidate.name} fits - you found them! 🎯` : "You've got it - one face left!",
      tone: "you",
    };
  } else if (guessMode) {
    status = { text: "Your turn - tap a remaining face to lock in your guess.", tone: "you" };
  } else {
    status = { text: "Your turn - ask one question, or make your guess.", tone: "you" };
  }

  // Only surface the confirm dialog for a pending guess that's still a live
  // candidate. In this turn-based game the board can't shift out from under your
  // own turn, but this keeps the "one and only guess" prompt honest if state ever
  // moves between arming a pending guess and the dialog rendering.
  const pendingPerson = pendingGuess && remaining.has(pendingGuess) ? getPerson(pendingGuess) : null;

  const scoreboard = (
    <Scoreboard
      you={you}
      opponent={opponent}
      myScore={myScore}
      oppScore={oppScore}
      roundNumber={game.roundNumber}
      bestOf={game.config.bestOf}
    />
  );

  // SELECTION PHASE: before any question or guess, each player secretly picks the
  // identity their opponent will hunt. The play board is hidden until both commit.
  if (game.selecting) {
    return (
      <div className="relative pt-2">
        {scoreboard}
        <SelectionScreen game={game} opponentName={opponentName} onChoose={onChoose} />
      </div>
    );
  }

  return (
    <div className="relative pt-2">
      {scoreboard}

      {/* Status line */}
      <div className="mb-4 text-center">
        <motion.div
          key={status.text}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cx(
            "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold shadow-e1",
            status.tone === "lock"
              ? "bg-danger/10 text-danger ring-1 ring-danger/30"
              : status.tone === "wait"
                ? "bg-surface text-ink-soft"
                : status.tone === "done"
                  ? "bg-brand-soft text-brand"
                  : "bg-brand text-white shadow-e2",
          )}
        >
          {status.tone === "lock" && <span aria-hidden>🔒</span>}
          {status.text}
        </motion.div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1fr_320px]">
        {/* The board of faces */}
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">The board</span>
            <span className="text-xs font-semibold text-ink-mute">
              <span className="text-ink">{remainingCount}</span> of {game.people.length} left
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {game.people.map((person) => (
              <FaceTile
                key={person.id}
                person={person}
                eliminated={!remaining.has(person.id)}
                selectable={guessMode && canGuessNow && remaining.has(person.id)}
                pending={pendingGuess === person.id}
                revealed={game.revealedOpponentPersonId === person.id}
                onClick={() => clickFace(person)}
              />
            ))}
          </div>

          {/* Your identity - the person your OPPONENT is hunting. */}
          {yourPerson && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface-2/60 px-4 py-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
                <FaceAvatar person={yourPerson} className="h-full w-full" />
              </div>
              <div className="text-sm leading-tight">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
                  You are
                </div>
                <div className="font-display text-lg font-bold text-ink">{yourPerson.name}</div>
                <div className="text-xs text-ink-mute">{opponentName} is trying to guess you.</div>
              </div>
            </div>
          )}
        </div>

        {/* Question panel + guess controls */}
        <div className="space-y-4">
          <QuestionPanel
            game={game}
            disabled={busy || alreadyGuessed || mustGuess || !yourTurn}
            onAsk={ask}
          />

          <div className="rounded-2xl border border-border bg-surface p-3 shadow-e1">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
                {opponentName}
              </span>
              <span className="text-xs text-ink-mute">
                {game.opponentAskedCount} {game.opponentAskedCount === 1 ? "question" : "questions"} asked
              </span>
            </div>
            {/* Never reveal whether their guess was right - only THAT they guessed. */}
            {game.opponentGuessed ? (
              <p className="px-1 text-sm font-medium text-ink-soft">🔒 They've locked in their guess.</p>
            ) : !yourTurn ? (
              <p className="px-1 text-sm text-ink-mute">It's their move…</p>
            ) : (
              <p className="px-1 text-sm text-ink-mute">Waiting on your move.</p>
            )}
          </div>

          {/* Guess controls */}
          {!alreadyGuessed && !roundOver && (
            <div>
              {mustGuess ? (
                <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-center text-sm font-medium text-danger">
                  🔒 {opponentName} locked in  -  pick your final guess on the board ↑
                </div>
              ) : !yourTurn ? (
                <div className="rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-center text-sm text-ink-soft">
                  Waiting for {opponentName} to take their turn…
                </div>
              ) : solved && soloCandidate ? (
                <div className="rounded-2xl border border-brand/40 bg-brand-soft px-4 py-4 text-center">
                  <div className="text-sm font-semibold text-brand">
                    You've narrowed it to one face - it has to be {soloCandidate.name}.
                  </div>
                  <Button
                    variant="primary"
                    fullWidth
                    className="mt-3"
                    disabled={busy}
                    onClick={() => setPendingGuess(soloCandidate.id)}
                  >
                    🎯 Lock in {soloCandidate.name}
                  </Button>
                  {/* Passing defers your guess so a still-searching opponent burns
                      more questions (helping the fewer-questions tiebreak). But once
                      THEY'VE also solved, deferring is pointless and the server forbids
                      it (two solved players could pass forever) - so we drop the option
                      and ask for the sure-thing guess. */}
                  {game.opponentSolved ? (
                    <p className="mt-2 px-1 text-center text-xs text-ink-mute">
                      {opponentName} has locked onto their answer too - take your guaranteed guess to
                      settle the round.
                    </p>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        fullWidth
                        className="mt-2"
                        loading={busy}
                        onClick={() => void passTurn()}
                      >
                        End turn without guessing →
                      </Button>
                      <p className="mt-2 px-1 text-center text-xs text-ink-mute">
                        A guess now is a sure thing. Or end your turn to hold your one guess in reserve.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {guessMode ? (
                    <Button variant="secondary" fullWidth onClick={() => setGuessMode(false)}>
                      ← Keep asking questions
                    </Button>
                  ) : (
                    <Button variant="primary" fullWidth onClick={() => setGuessMode(true)}>
                      I'm ready to guess 🎯
                    </Button>
                  )}
                  <p className="mt-2 px-1 text-center text-xs text-ink-mute">
                    Take turns: ask <b>one</b> question, or spend your <b>one</b> guess. The moment either of
                    you guesses, the other is locked into their final shot.
                  </p>
                </>
              )}
            </div>
          )}

          {alreadyGuessed && !roundOver && (
            <div className="rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-center text-sm text-ink-soft">
              Your guess is in. Sit tight while {opponentName} takes their shot.
            </div>
          )}
        </div>
      </div>

      {/* Guess confirm dialog */}
      <AnimatePresence>
        {pendingPerson && !alreadyGuessed && !roundOver && (
          <ModalShell
            onClose={() => !busy && setPendingGuess(null)}
            labelledBy="gtp-guess-confirm-title"
            className="w-full max-w-xs rounded-2xl border border-border bg-surface p-6 text-center shadow-e5"
          >
            <div className="mx-auto mb-3 h-24 w-24 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border">
              <FaceAvatar person={pendingPerson} className="h-full w-full" />
            </div>
            <h3 id="gtp-guess-confirm-title" className="font-display text-lg font-bold text-ink">
              Guess {pendingPerson.name}?
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              This is your one and only guess - no take-backs.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" fullWidth disabled={busy} onClick={() => setPendingGuess(null)}>
                Cancel
              </Button>
              <Button fullWidth loading={busy} onClick={() => void confirmGuess()}>
                Lock it in
              </Button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

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

// ---- accessible modal shell -------------------------------------------------

/**
 * The focus-trapping, Escape-closable backdrop shared by every dialog in this
 * game (guess confirm, identity confirm, round/match overlay). Centralizing the
 * a11y contract here - role/aria-modal, initial focus, a Tab focus-trap, and
 * reduced-motion handling - keeps the three dialogs from drifting apart. Pass
 * `onClose` to allow dismissal (Escape + backdrop click); omit it for a modal
 * that must be actioned (the round overlay). The global reduced-motion CSS only
 * tames CSS transitions, so Framer's JS-driven entrance is handled explicitly.
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
  // Callers pass an inline `onClose`, so keep the latest in a ref rather than an
  // effect dependency - otherwise the effect would re-run every render and yank
  // focus back to the first element mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Pull focus into the dialog on open and trap Tab within it, so keyboard and
  // screen-reader users can't wander back to the (inert) board behind the modal.
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

// ---- scoreboard -------------------------------------------------------------

function Scoreboard({
  you,
  opponent,
  myScore,
  oppScore,
  roundNumber,
  bestOf,
}: {
  you: RoomStatePayload["you"];
  opponent: RoomStatePayload["players"][number] | null;
  myScore: number;
  oppScore: number;
  roundNumber: number;
  bestOf: number;
}) {
  return (
    <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-e2">
      <div className="flex items-center gap-2">
        <PlayerBadge nickname={you.nickname} you connected size="sm" />
        <span className="font-display text-2xl font-bold text-ink">{myScore}</span>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
          Round {roundNumber}
        </div>
        <div className="text-xs text-ink-mute">Guess the Person · Best of {bestOf}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-display text-2xl font-bold text-ink">{oppScore}</span>
        {opponent ? (
          <PlayerBadge nickname={opponent.nickname} connected={opponent.connected} size="sm" />
        ) : (
          <span className="text-xs text-ink-mute">-</span>
        )}
      </div>
    </div>
  );
}

// ---- selection screen -------------------------------------------------------

/**
 * The pre-round identity picker. You choose (from the full board) the person your
 * OPPONENT will try to guess - or tap "Surprise me" for a random pick. "Surprise
 * me" is CLIENT-side random on purpose: both players know the room seed, so a
 * server-seeded pick could be reproduced by the opponent. Once you commit, you
 * wait for your opponent; when both have chosen, the hunt begins.
 */
function SelectionScreen({
  game,
  opponentName,
  onChoose,
}: {
  game: GuessWhoPublicView;
  opponentName: string;
  onChoose: (personId: string) => Promise<Result<null>>;
}) {
  const { show } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = game.youChose;

  // Once BOTH players have committed, the server flips `selecting` false and this
  // screen unmounts. If our own commit request is still in flight when that
  // happens, its resolution must not touch state on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commit = useCallback(
    async (personId: string) => {
      if (busy) return;
      setBusy(true);
      const res = await onChoose(personId);
      if (!mounted.current) return; // screen already gone (both chose) - nothing to update
      setBusy(false);
      if (!res.ok) {
        show(res.error.message, "warning");
        setPending(null);
      }
      // On success the view flips youChose true (or the round starts).
    },
    [busy, onChoose, show],
  );

  const surprise = useCallback(() => {
    if (busy || chosen) return;
    // Client-side random (never server-seeded - the opponent knows the room seed).
    const pick = game.people[Math.floor(Math.random() * game.people.length)];
    if (pick) setPending(pick.id);
  }, [busy, chosen, game.people]);

  const pendingPerson = pending ? getPerson(pending) : null;

  // After you've committed, wait for the opponent (the round auto-starts when both
  // are in, so this is the only "chosen but still selecting" state you can see).
  if (chosen) {
    const yours = getPerson(game.yourPersonId);
    return (
      <div className="mx-auto max-w-md pt-6 text-center">
        <div className="rounded-2xl border border-border bg-surface p-7 shadow-e2">
          {yours && (
            <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border">
              <FaceAvatar person={yours} className="h-full w-full" />
            </div>
          )}
          <h2 className="font-display text-xl font-bold text-ink">
            You're {yours?.name ?? "in"} 🤫
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {opponentName} has to guess this is you. Waiting for them to lock in their pick…
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-1.5 text-sm font-medium text-ink-soft">
            <span
              className="h-4 w-4 rounded-full border-2 border-ink-mute/40 border-t-brand animate-spin"
              aria-hidden
            />
            Waiting for {opponentName}…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pt-1">
      <div className="mb-4 text-center">
        <h2 className="font-display text-2xl font-bold text-ink">Pick your secret identity</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Choose the face {opponentName} will have to guess. They'll never see who you picked.
        </p>
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={surprise} disabled={busy}>
            🎲 Surprise me
          </Button>
          {game.opponentChose && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
              ✓ {opponentName} is ready
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
        {game.people.map((person) => (
          <FaceTile
            key={person.id}
            person={person}
            eliminated={false}
            selectable={!busy}
            pending={pending === person.id}
            revealed={false}
            onClick={() => !busy && setPending(person.id)}
          />
        ))}
      </div>

      {/* Confirm dialog */}
      <AnimatePresence>
        {pendingPerson && (
          <ModalShell
            onClose={() => !busy && setPending(null)}
            labelledBy="gtp-identity-confirm-title"
            className="w-full max-w-xs rounded-2xl border border-border bg-surface p-6 text-center shadow-e5"
          >
            <div className="mx-auto mb-3 h-24 w-24 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border">
              <FaceAvatar person={pendingPerson} className="h-full w-full" />
            </div>
            <h3 id="gtp-identity-confirm-title" className="font-display text-lg font-bold text-ink">
              Be {pendingPerson.name}?
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              This is the person {opponentName} will hunt for. You can't change it once you lock in.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" fullWidth disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button fullWidth loading={busy} onClick={() => void commit(pendingPerson.id)}>
                Lock it in
              </Button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- board tile -------------------------------------------------------------

function FaceTile({
  person,
  eliminated,
  selectable,
  pending,
  revealed,
  onClick,
}: {
  person: Person;
  eliminated: boolean;
  selectable: boolean;
  pending: boolean;
  revealed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!selectable}
      aria-label={person.name}
      className={cx(
        "group relative overflow-hidden rounded-xl border bg-surface-2 outline-none transition-all",
        revealed
          ? "border-brand ring-2 ring-brand shadow-e3"
          : pending
            ? "border-brand ring-2 ring-brand"
            : "border-border",
        selectable
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-brand hover:shadow-e2 focus-visible:ring-2 focus-visible:ring-brand"
          : "cursor-default",
        eliminated && !revealed ? "opacity-40 grayscale" : "",
      )}
    >
      <FaceAvatar person={person} className="aspect-square w-full" />
      {/* Eliminated overlay - a big translucent X, like flipping a Guess Who tile. */}
      {eliminated && !revealed && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/25">
          <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-white/90" aria-hidden>
            <path
              d="M5 5 L19 19 M19 5 L5 19"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
      {revealed && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-brand py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-white">
          It was them
        </span>
      )}
      <span
        className={cx(
          "block truncate px-1 py-0.5 text-center text-[11px] font-semibold",
          revealed ? "text-brand" : "text-ink-soft",
        )}
      >
        {person.name}
      </span>
    </button>
  );
}

// ---- question panel ---------------------------------------------------------

function QuestionPanel({
  game,
  disabled,
  onAsk,
}: {
  game: GuessWhoPublicView;
  disabled: boolean;
  /** The parent's `ask` wrapper already surfaces errors via a toast. */
  onAsk: (section: QuestionSection, value: string) => void;
}) {
  // Fast lookups: what have I asked, and what may I still ask?
  const askedMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of game.asked) m.set(`${a.section}:${a.value}`, a.answer);
    return m;
  }, [game.asked]);
  const availableSet = useMemo(
    () => new Set(game.availableQuestions.map((q) => `${q.section}:${q.value}`)),
    [game.availableQuestions],
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-e1">
      <div className="mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Ask a question</span>
        <p className="text-xs text-ink-mute">Each answer flips away the faces that don't match.</p>
      </div>
      <div className="space-y-2.5">
        {QUESTION_SECTIONS.map((meta) => (
          <div key={meta.section}>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-mute/80">
              {meta.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {meta.values.map((v) => {
                const key = `${meta.section}:${v.value}`;
                const answered = askedMap.has(key);
                const answer = askedMap.get(key);
                const canAsk = !disabled && availableSet.has(key);
                return (
                  <button
                    key={v.value}
                    type="button"
                    disabled={!canAsk}
                    onClick={() => canAsk && void onAsk(meta.section, v.value)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                      answered
                        ? answer
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border bg-surface-2 text-ink-mute line-through"
                        : canAsk
                          ? "border-border bg-surface-2 text-ink-soft hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
                          : "border-transparent bg-surface-2/50 text-ink-mute/50",
                    )}
                  >
                    {v.label}
                    {answered && <span aria-hidden>{answer ? "✓" : "✕"}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
  game: GuessWhoPublicView;
  mySeat: Seat;
  opponentName: string;
  matchOver: boolean;
  onNextRound: () => Promise<Result<null>>;
  onRematch: () => Promise<Result<null>>;
}) {
  const { show } = useToast();
  const [readying, setReadying] = useState(false);
  const iWonRound = game.roundWinnerSeat === mySeat;
  const roundTie = game.roundWinnerSeat === "tie";
  const matchWinner = game.matchWinnerSeat;

  const myGuess = game.yourGuess;
  const oppGuess = game.opponentGuess;
  const bothCorrect = myGuess?.correct === true && oppGuess?.correct === true;
  const revealed = game.revealedOpponentPersonId ? getPerson(game.revealedOpponentPersonId) : null;

  // How many questions each side asked - drives the "fewer questions" tie-break.
  const myAsked = game.questionCounts ? game.questionCounts[mySeat] : game.asked.length;
  const oppAsked = game.questionCounts
    ? game.questionCounts[mySeat === "A" ? "B" : "A"]
    : game.opponentAskedCount;

  let title: string;
  let subtitle: string | null = null;
  if (matchOver) {
    if (matchWinner === "tie") title = "It's a tie! 🤝";
    else title = matchWinner === mySeat ? "You win the match! 🏆" : "You lost the match";
  } else if (roundTie) {
    if (bothCorrect) {
      title = "Both nailed it - draw! 🤝";
      subtitle = `You each guessed right in ${myAsked} question${myAsked === 1 ? "" : "s"} - dead heat, no point.`;
    } else {
      title = "Nobody got it - draw";
    }
  } else if (iWonRound) {
    title = "You won the round! 🎉";
    if (bothCorrect) subtitle = `Both right, but you needed fewer questions (${myAsked} vs ${oppAsked}).`;
  } else {
    title = bothCorrect ? `${opponentName} won on fewer questions` : `${opponentName} got you`;
    if (bothCorrect) subtitle = `You both guessed right, but they used fewer questions (${oppAsked} vs ${myAsked}).`;
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

  return (
    <ModalShell
      labelledBy="gtp-round-overlay-title"
      zClass="z-50"
      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 text-center shadow-e5"
    >
      <div>
        <div className="mb-4 flex justify-center gap-3">
          <ScorePill label="You" value={mySeat === "A" ? game.scores.A : game.scores.B} highlight />
          <span className="self-center text-ink-mute">vs</span>
          <ScorePill label="Them" value={mySeat === "A" ? game.scores.B : game.scores.A} />
        </div>
        <h2 id="gtp-round-overlay-title" className="font-display text-2xl font-bold text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}

        {/* Reveal: who the opponent actually was + how your guess did. */}
        {revealed && (
          <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl bg-surface-2 p-3">
            <div className="h-16 w-16 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
              <FaceAvatar person={revealed} className="h-full w-full" />
            </div>
            <div className="text-left text-sm leading-tight">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
                They were
              </div>
              <div className="font-display text-lg font-bold text-ink">{revealed.name}</div>
              <div className={cx("text-xs font-semibold", myGuess?.correct ? "text-success" : "text-danger")}>
                {myGuess
                  ? myGuess.correct
                    ? "You guessed right ✓"
                    : `You guessed ${getPerson(myGuess.personId)?.name ?? "wrong"} ✕`
                  : "You didn't guess in time"}
              </div>
            </div>
          </div>
        )}

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
