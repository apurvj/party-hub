import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DiceCategory, GameId, MatchTier, WordleMode } from "@party-hub/shared";
import {
  DICE_CATEGORIES,
  DICE_CATEGORY_META,
  MATCH_TIERS,
  MATCH_TIER_META,
  dicePool,
  isValidRoomCode,
  normalizeRoomCode,
} from "@party-hub/shared";
import { AppShell } from "../components/AppShell.js";
import { Button, Card, Input, cx, useToast } from "../design-system/index.js";
import { getNickname, setNickname } from "../net/identity.js";
import { getSocket, emitAck } from "../net/socket.js";
import type { CreateRoomReq, CreateRoomRes, Result } from "@party-hub/shared";

type GameOption = { value: GameId; label: string; blurb: string; icon: string };

/** The everyday, all-audiences games - shown up front. */
const FAMILY_GAMES: GameOption[] = [
  { value: "wordle", label: "Wordle", blurb: "Guess the 5-letter word", icon: "🟩" },
  { value: "uno", label: "Uno", blurb: "Empty your hand first", icon: "🎴" },
  { value: "guess-the-person", label: "Guess the Person", blurb: "Ask, narrow, pinpoint them", icon: "🕵️" },
  { value: "connect-four", label: "Connect Four", blurb: "Line up four to win", icon: "🔴" },
];

/** Explicit, 18+ games - tucked behind a discreet, collapsed disclosure. */
const ADULT_GAMES: GameOption[] = [
  { value: "match", label: "Match", blurb: "Swipe your desires", icon: "💞" },
  { value: "dice", label: "Dare Roulette", blurb: "Spin, dare, score", icon: "🎲" },
];

const DECK_SIZES = [12, 24, 40];

const DICE_TARGETS = [9, 12, 18];

const MODES: { value: WordleMode; label: string; blurb: string; icon: string }[] = [
  { value: "race", label: "Race", blurb: "Same word, first to solve wins", icon: "⚡️" },
  { value: "coop", label: "Co-op", blurb: "Solve one board together, take turns", icon: "🤝" },
];

const BEST_OF = [1, 3, 5];

export function HomePage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [nickname, setNick] = useState(getNickname());
  const [joinCode, setJoinCode] = useState("");
  const [gameId, setGameId] = useState<GameId>("wordle");
  // Adult games hide behind a collapsed "▼ Adult games" disclosure, closed by
  // default so the explicit games aren't shown until deliberately expanded.
  const [adultOpen, setAdultOpen] = useState(false);
  const [mode, setMode] = useState<WordleMode>("race");
  const [bestOf, setBestOf] = useState(3);
  // Match config
  const [tiers, setTiers] = useState<MatchTier[]>([...MATCH_TIERS]);
  const [deckSize, setDeckSize] = useState(24);
  const [allowMedia, setAllowMedia] = useState(true);
  // Dice (Dare Roulette) config
  const [diceCats, setDiceCats] = useState<DiceCategory[]>([...DICE_CATEGORIES]);
  const [targetScore, setTargetScore] = useState(12);
  const [diceMedia, setDiceMedia] = useState(true);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const nick = nickname.trim();

  function toggleTier(t: MatchTier) {
    setTiers((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      // Keep canonical order and never allow an empty selection.
      return next.length ? MATCH_TIERS.filter((x) => next.includes(x)) : prev;
    });
  }

  function toggleDiceCat(c: DiceCategory) {
    setDiceCats((prev) => {
      const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
      // Keep canonical order and never allow an empty selection.
      return next.length ? DICE_CATEGORIES.filter((x) => next.includes(x)) : prev;
    });
  }

  async function handleCreate() {
    if (!nick) return show("Pick a nickname first!", "warning");
    if (gameId === "match" && tiers.length === 0) return show("Pick at least one spice level.", "warning");
    if (gameId === "dice" && diceCats.length === 0) return show("Pick at least one kink.", "warning");
    // A Dice deck is built per body, and some selections empty out once media is
    // off (e.g. "Show off" only - every one of its dares is a media card), which
    // would leave nothing to spin. Catch it here with a clear nudge; the server
    // also repairs this defensively, but the UI should never silently override
    // the couple's choice.
    if (
      gameId === "dice" &&
      !diceMedia &&
      (dicePool({ categories: diceCats, targetScore, allowMedia: false }, "female").length === 0 ||
        dicePool({ categories: diceCats, targetScore, allowMedia: false }, "male").length === 0)
    ) {
      return show("Those kinks are all media-based - turn media back on or add another kink.", "warning");
    }
    setNickname(nick);
    setBusy("create");
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    const req: CreateRoomReq =
      gameId === "uno"
        ? { gameId: "uno", uno: { bestOf } }
        : gameId === "guess-the-person"
          ? { gameId: "guess-the-person", "guess-the-person": { bestOf } }
          : gameId === "connect-four"
            ? { gameId: "connect-four", "connect-four": { bestOf } }
            : gameId === "match"
              ? { gameId: "match", match: { tiers, deckSize, allowMedia } }
              : gameId === "dice"
                ? { gameId: "dice", dice: { categories: diceCats, targetScore, allowMedia: diceMedia } }
                : { gameId: "wordle", wordle: { mode, bestOf, difficulty: "normal" } };
    const res = await emitAck<CreateRoomReq, Result<CreateRoomRes>>(sock, "room:create", req);
    setBusy(null);
    if (res.ok) navigate(`/room/${res.data.code}`);
    else show(res.error.message, "danger");
  }

  async function handleJoin() {
    if (!nick) return show("Pick a nickname first!", "warning");
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) return show("That room code doesn't look right.", "warning");
    setNickname(nick);
    setBusy("join");
    // Navigate; RoomPage handles the actual join/reconnect on mount.
    navigate(`/room/${code}`);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
          className="mb-8 text-center"
        >
          <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">
            Play together,
            <br />
            <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent">
              from anywhere.
            </span>
          </h1>
          <p className="mt-3 text-lg text-ink-soft">
            Spin up a private room and share the link with a friend. Wordle, Uno, and more - ready to play.
          </p>
        </motion.div>

        <Card className="space-y-6">
          <Input
            label="Your nickname"
            placeholder="e.g. Alex"
            value={nickname}
            maxLength={16}
            onChange={(e) => setNick(e.target.value)}
          />

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-soft">Game</span>
            <div className="grid grid-cols-2 gap-3">
              {FAMILY_GAMES.map((g) => (
                <GameTile key={g.value} game={g} selected={gameId === g.value} onSelect={() => setGameId(g.value)} />
              ))}
            </div>

            {/* Discreet, collapsed disclosure for the explicit 18+ games. */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setAdultOpen((v) => !v)}
                aria-expanded={adultOpen}
                aria-controls="adult-games"
                className={cx(
                  "flex w-full items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink-soft transition-all hover:border-[#f0487f]/50",
                  adultOpen && "border-[#f0487f]/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden>🔞</span>
                  Adult games
                  <span className="text-xs font-normal text-ink-mute">(18+)</span>
                </span>
                <motion.span
                  aria-hidden
                  animate={{ rotate: adultOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-ink-mute"
                >
                  ▼
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {adultOpen && (
                  <motion.div
                    id="adult-games"
                    key="adult-games"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3 pt-3">
                      {ADULT_GAMES.map((g) => (
                        <GameTile
                          key={g.value}
                          game={g}
                          selected={gameId === g.value}
                          adult
                          onSelect={() => setGameId(g.value)}
                        />
                      ))}
                    </div>
                    <p className="mt-2.5 px-1 text-xs text-ink-mute">
                      Explicit, for consenting adults playing together. You'll confirm 18+ before anything starts.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {gameId === "wordle" && (
            <div>
              <span className="mb-2 block text-sm font-medium text-ink-soft">Mode</span>
              <div className="grid grid-cols-2 gap-3">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={cx(
                      "rounded-xl border p-4 text-left transition-all",
                      mode === m.value
                        ? "border-brand bg-brand-soft/60 shadow-e2"
                        : "border-border bg-surface-2 hover:border-brand/50",
                    )}
                  >
                    <div className="text-2xl">{m.icon}</div>
                    <div className="mt-1 font-semibold text-ink">{m.label}</div>
                    <div className="text-xs text-ink-mute">{m.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {gameId === "match" && (
            <MatchOptions
              tiers={tiers}
              onToggleTier={toggleTier}
              deckSize={deckSize}
              onDeckSize={setDeckSize}
              allowMedia={allowMedia}
              onAllowMedia={setAllowMedia}
            />
          )}

          {gameId === "dice" && (
            <DiceOptions
              cats={diceCats}
              onToggleCat={toggleDiceCat}
              targetScore={targetScore}
              onTargetScore={setTargetScore}
              allowMedia={diceMedia}
              onAllowMedia={setDiceMedia}
            />
          )}

          {gameId !== "match" && gameId !== "dice" && (
            <div>
              <span className="mb-2 block text-sm font-medium text-ink-soft">Match length</span>
              <div className="flex gap-2">
                {BEST_OF.map((n) => (
                  <button
                    key={n}
                    onClick={() => setBestOf(n)}
                    className={cx(
                      "flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all",
                      bestOf === n
                        ? "border-brand bg-brand text-white"
                        : "border-border bg-surface-2 text-ink-soft hover:border-brand/50",
                    )}
                  >
                    {n === 1 ? "Single" : `Best of ${n}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button size="lg" fullWidth loading={busy === "create"} onClick={handleCreate}>
            Create private room
          </Button>
        </Card>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-sm font-medium text-ink-mute">or join a friend</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Room code"
                placeholder="ABC123"
                value={joinCode}
                maxLength={6}
                autoCapitalize="characters"
                className="uppercase tracking-wide font-display"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
            </div>
            <Button
              variant="secondary"
              size="lg"
              loading={busy === "join"}
              onClick={handleJoin}
              className="sm:w-32"
            >
              Join
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

/** A single game choice tile. Adult tiles use the rose accent when selected. */
function GameTile({
  game,
  selected,
  adult = false,
  onSelect,
}: {
  game: GameOption;
  selected: boolean;
  adult?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "rounded-xl border p-4 text-left transition-all",
        selected
          ? adult
            ? "border-[#f0487f] bg-[#f0487f]/10 shadow-e2"
            : "border-brand bg-brand-soft/60 shadow-e2"
          : adult
            ? "border-border bg-surface-2 hover:border-[#f0487f]/50"
            : "border-border bg-surface-2 hover:border-brand/50",
      )}
    >
      <div className="text-2xl">{game.icon}</div>
      <div className="mt-1 font-semibold text-ink">{game.label}</div>
      <div className="text-xs text-ink-mute">{game.blurb}</div>
    </button>
  );
}

/** Spice tier, deck size, and media controls for a Match room. */
function MatchOptions({
  tiers,
  onToggleTier,
  deckSize,
  onDeckSize,
  allowMedia,
  onAllowMedia,
}: {
  tiers: MatchTier[];
  onToggleTier: (t: MatchTier) => void;
  deckSize: number;
  onDeckSize: (n: number) => void;
  allowMedia: boolean;
  onAllowMedia: (b: boolean) => void;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-[#f0487f]/30 bg-[#f0487f]/5 p-4">
      <div>
        <span className="mb-2 block text-sm font-medium text-ink-soft">
          Spice levels <span className="text-ink-mute">(pick one or more)</span>
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          {MATCH_TIERS.map((t) => {
            const meta = MATCH_TIER_META[t];
            const on = tiers.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTier(t)}
                aria-pressed={on}
                className={cx(
                  "rounded-xl border p-3 text-left transition-all",
                  on
                    ? "border-[#f0487f] bg-[#f0487f]/10 shadow-e1"
                    : "border-border bg-surface-2 hover:border-[#f0487f]/50",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">{meta.emoji}</span>
                  <span className="font-semibold text-ink">{meta.label}</span>
                  {on && <span className="ml-auto text-[#f0487f]">✓</span>}
                </div>
                <div className="text-xs text-ink-mute">{meta.blurb}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-ink-soft">Deck size</span>
        <div className="flex gap-2">
          {DECK_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onDeckSize(n)}
              className={cx(
                "flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all",
                deckSize === n
                  ? "border-[#f0487f] bg-[#f0487f] text-white"
                  : "border-border bg-surface-2 text-ink-soft hover:border-[#f0487f]/50",
              )}
            >
              {n} cards
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={allowMedia}
          onChange={(e) => onAllowMedia(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-[#f0487f]"
        />
        <span className="text-sm text-ink-soft">
          <span className="font-medium text-ink">Include photo / video / voice prompts</span>
          <span className="block text-xs text-ink-mute">
            Cards that suggest sending or recording media. Turn off to keep it words-only.
          </span>
        </span>
      </label>

      <p className="text-xs text-ink-mute">
        🔒 Your swipes stay private - only ideas you <b>both</b> say yes to are revealed. 18+ only.
      </p>
    </div>
  );
}

/** Kink categories, target score, and media controls for a Dare Roulette room. */
function DiceOptions({
  cats,
  onToggleCat,
  targetScore,
  onTargetScore,
  allowMedia,
  onAllowMedia,
}: {
  cats: DiceCategory[];
  onToggleCat: (c: DiceCategory) => void;
  targetScore: number;
  onTargetScore: (n: number) => void;
  allowMedia: boolean;
  onAllowMedia: (b: boolean) => void;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-[#d11f5c]/30 bg-[#d11f5c]/5 p-4">
      <div>
        <span className="mb-2 block text-sm font-medium text-ink-soft">
          Kinks in the deck <span className="text-ink-mute">(pick what you're both into)</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {DICE_CATEGORIES.map((c) => {
            const meta = DICE_CATEGORY_META[c];
            const on = cats.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => onToggleCat(c)}
                aria-pressed={on}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all",
                  on
                    ? "border-[#d11f5c] bg-[#d11f5c]/10 text-ink shadow-e1"
                    : "border-border bg-surface-2 text-ink-soft hover:border-[#d11f5c]/50",
                )}
              >
                <span>{meta.emoji}</span>
                {meta.label}
                {on && <span className="text-[#d11f5c]">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-ink-soft">Play to</span>
        <div className="flex gap-2">
          {DICE_TARGETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onTargetScore(n)}
              className={cx(
                "flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all",
                targetScore === n
                  ? "border-[#d11f5c] bg-[#d11f5c] text-white"
                  : "border-border bg-surface-2 text-ink-soft hover:border-[#d11f5c]/50",
              )}
            >
              {n} pts
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={allowMedia}
          onChange={(e) => onAllowMedia(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-[#d11f5c]"
        />
        <span className="text-sm text-ink-soft">
          <span className="font-medium text-ink">Include photo / video / voice dares</span>
          <span className="block text-xs text-ink-mute">
            Dares that involve sending or recording media. Turn off to keep it live-only.
          </span>
        </span>
      </label>

      <p className="text-xs text-ink-mute">
        🔥 Wild-only, explicit dares. Pass anything with no penalty, or safeword to stop instantly. 18+ only.
      </p>
    </div>
  );
}
