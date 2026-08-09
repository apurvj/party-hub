import { motion, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";
import type { Sex } from "@party-hub/shared";
import { Button, PlayerBadge, cx } from "../../design-system/index.js";

/**
 * Shared consent + body gate for the adult games (Match, Dice). Both games open
 * on the SAME gate so the flow, copy, and safety framing are identical: the
 * player confirms they're a consenting adult AND picks the body their dares
 * should be tailored to, in one screen, before any explicit content renders.
 *
 * WHY A BODY PICKER: the server filters the deck by anatomy (see sex.ts /
 * dicePool / matchPool) so nobody is ever handed a dare their body can't do.
 * That filter needs each player's body, and the gate is the natural, private,
 * per-player place to collect it - it's declared once and then baked into the
 * seeded deck.
 *
 * REMEMBERED PER DEVICE: consent + the last body are persisted so a returning
 * player gets a pre-filled, one-tap gate - but never auto-submitted, so someone
 * playing with a new partner can still change their answer.
 */

/** Per-device acknowledgement that both players are consenting adults. Shared
 *  across the adult games so agreeing once carries between them. */
const CONSENT_KEY = "party-hub:match-consent";
/** Per-device memory of the last body chosen, to pre-fill the gate. */
const BODY_KEY = "party-hub:adult-body";

function hasConsented(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(CONSENT_KEY) === "1";
}

function rememberedBody(): Sex | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(BODY_KEY);
  return v === "female" || v === "male" ? v : null;
}

function remember(sex: Sex): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, "1");
  window.localStorage.setItem(BODY_KEY, sex);
}

export interface AdultTheme {
  /** Header banner background (a CSS gradient string). */
  headerGradient: string;
  /** Accent hex used for the checkbox + selected body ring/CTA. */
  accent: string;
  emoji: string;
  title: string;
  tagline: string;
  cta: string;
}

/**
 * The full pre-game gate: game-specific intro bullets, the 18+ consent
 * checkbox, and the Woman/Man body picker. Calls `onConfirm(sex)` once the
 * player has consented AND chosen a body. The parent is responsible for
 * dispatching set_sex; this component only collects + persists the choice.
 */
export function AdultConsentGate({
  theme,
  bullets,
  onConfirm,
  busy = false,
}: {
  theme: AdultTheme;
  bullets: ReactNode;
  onConfirm: (sex: Sex) => void;
  busy?: boolean;
}) {
  // Pre-fill from device memory so a returning player just taps the CTA.
  const [checked, setChecked] = useState(hasConsented);
  const [body, setBody] = useState<Sex | null>(rememberedBody);
  // Skip the slide-up entrance for motion-sensitive users (a plain fade remains).
  const reduceMotion = useReducedMotion();

  const ready = checked && body !== null && !busy;

  const confirm = () => {
    if (!checked || body === null) return;
    remember(body);
    onConfirm(body);
  };

  return (
    <div className="mx-auto max-w-md pt-10">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
      >
        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-e4">
          <div className="px-7 py-8 text-center text-white" style={{ background: theme.headerGradient }}>
            <div className="text-4xl">{theme.emoji}</div>
            <h2 className="mt-2 font-display text-2xl font-black">{theme.title}</h2>
            <p className="mt-1 text-sm font-medium text-white/90">{theme.tagline}</p>
          </div>
          <div className="space-y-4 p-7">
            <ul className="space-y-2.5 text-sm text-ink-soft">{bullets}</ul>

            {/* Body picker - tailors the deck to what each player can do. */}
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-2.5 flex items-start gap-2 text-sm text-ink">
                <span aria-hidden>🧍</span>
                <span>
                  So we only ever show you dares your body can do, tell us who's playing on <b>this</b>{" "}
                  device:
                </span>
              </div>
              <div
                className="grid grid-cols-2 gap-2.5"
                role="radiogroup"
                aria-label="Your body"
                onKeyDown={(e) => {
                  // ARIA radiogroup pattern: arrow keys move the selection
                  // between the two options (wrapping), not just Tab+Space.
                  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
                    e.preventDefault();
                    setBody((prev) => (prev === "female" ? "male" : "female"));
                  }
                }}
              >
                <BodyOption
                  label="Woman"
                  emoji="♀"
                  selected={body === "female"}
                  // Roving tabindex: the checked radio is the tab stop; if none is
                  // chosen yet, the first option is, so Tab always lands in-group.
                  tabIndex={body === "female" || body === null ? 0 : -1}
                  accent={theme.accent}
                  onSelect={() => setBody("female")}
                />
                <BodyOption
                  label="Man"
                  emoji="♂"
                  selected={body === "male"}
                  tabIndex={body === "male" ? 0 : -1}
                  accent={theme.accent}
                  onSelect={() => setBody("male")}
                />
              </div>
              <p className="mt-2 text-xs text-ink-mute">
                Private to you - your partner never sees this, only the dares it unlocks.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-5 w-5"
                style={{ accentColor: theme.accent }}
              />
              <span className="text-sm text-ink">
                We're both 18 or older and consent to playing an explicit game together.
              </span>
            </label>

            <Button fullWidth size="lg" loading={busy} disabled={!ready} onClick={confirm}>
              {theme.cta}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BodyOption({
  label,
  emoji,
  selected,
  accent,
  tabIndex,
  onSelect,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  accent: string;
  tabIndex: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      className={cx(
        "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-semibold outline-none transition-all focus-visible:ring-4",
        selected ? "text-ink shadow-e2" : "border-border bg-surface text-ink-soft hover:border-ink-mute",
      )}
      style={
        selected
          ? { borderColor: accent, background: `${accent}14`, boxShadow: `0 0 0 1px ${accent}` }
          : undefined
      }
    >
      <span className="text-lg" aria-hidden style={selected ? { color: accent } : undefined}>
        {emoji}
      </span>
      {label}
    </button>
  );
}

/**
 * Shown during the "setup" stage after YOU'VE declared your body but your
 * partner hasn't yet - the deck can't be built until both are in. Themed to
 * match its game.
 */
export function AwaitingPartner({
  theme,
  opponentName,
  opponentConnected,
  youName,
}: {
  theme: AdultTheme;
  opponentName: string;
  opponentConnected: boolean;
  youName: string;
}) {
  // Respect prefers-reduced-motion: skip the slide-up entrance AND the endless
  // pulsing dots (a static "•••" is enough) - a looping animation would
  // otherwise run indefinitely for a motion-sensitive user (WCAG 2.3.3).
  const reduceMotion = useReducedMotion();
  return (
    <div className="mx-auto max-w-md pt-16">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
        className="flex flex-col items-center rounded-3xl border border-border bg-surface p-8 text-center shadow-e4"
      >
        <div
          className="mb-4 grid h-16 w-16 place-items-center rounded-2xl text-3xl text-white shadow-e2"
          style={{ background: theme.headerGradient }}
        >
          {theme.emoji}
        </div>
        <h2 className="font-display text-xl font-bold text-ink">You're all set, {youName} ✓</h2>
        <p className="mt-2 max-w-xs text-sm text-ink-soft">
          {opponentConnected
            ? `Waiting for ${opponentName} to pick their body too - then the deck is dealt.`
            : `Waiting for ${opponentName} to join and get set up…`}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <PlayerBadge nickname={youName} you connected size="sm" />
          <motion.span
            className="text-ink-mute"
            animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.3, 1, 0.3] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 1.4, repeat: Infinity }}
            aria-hidden
          >
            •••
          </motion.span>
          <PlayerBadge nickname={opponentName} connected={opponentConnected} size="sm" />
        </div>
      </motion.div>
    </div>
  );
}
