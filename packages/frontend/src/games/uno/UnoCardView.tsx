import { motion } from "framer-motion";
import type { CardColor, PublicCard, UnoCard, UnoCardKind } from "@party-hub/shared";
import { cx } from "../../design-system/index.js";

/**
 * Vivid Uno face colors - fixed (not theme vars) so cards read as real Uno.
 * Each color carries a base + a slightly darker shade for a subtle top-down
 * gradient, giving the plastic-card sheen instead of a flat fill.
 */
const COLOR_BG: Record<Exclude<CardColor, null>, string> = {
  red: "bg-[linear-gradient(150deg,#f04a43_0%,#d81e18_60%,#b3120d_100%)]",
  yellow: "bg-[linear-gradient(150deg,#ffc933_0%,#f0a800_60%,#d18f00_100%)]",
  green: "bg-[linear-gradient(150deg,#3fbe5b_0%,#1f9d3f_60%,#137a2c_100%)]",
  blue: "bg-[linear-gradient(150deg,#3f83ee_0%,#1f5fd6_60%,#1348ac_100%)]",
};

/** The glyph color drawn on the center oval - matches the card body. */
const COLOR_INK: Record<Exclude<CardColor, null>, string> = {
  red: "text-[#d81e18]",
  yellow: "text-[#e5a100]",
  green: "text-[#1f9d3f]",
  blue: "text-[#1f5fd6]",
};

/** Short glyph for action cards; number cards render their digit. */
function faceLabel(kind: UnoCardKind, value: number | null): string {
  switch (kind) {
    case "number":
      return String(value ?? "");
    case "skip":
      return "🚫";
    case "reverse":
      return "⇄";
    case "draw_two":
      return "+2";
    case "wild":
      return "";
    case "wild_draw_four":
      return "+4";
  }
}

/** Compact glyph for the tiny corner indices. */
function cornerLabel(kind: UnoCardKind, value: number | null): string {
  switch (kind) {
    case "number":
      return String(value ?? "");
    case "skip":
      return "Ø";
    case "reverse":
      return "⇄";
    case "draw_two":
      return "+2";
    case "wild":
      return "W";
    case "wild_draw_four":
      return "+4";
  }
}

/** Accessible label for screen readers. */
export function cardAria(card: PublicCard | UnoCard): string {
  const color = card.color ? `${card.color} ` : "";
  switch (card.kind) {
    case "number":
      return `${color}${card.value}`;
    case "skip":
      return `${color}skip`;
    case "reverse":
      return `${color}reverse`;
    case "draw_two":
      return `${color}draw two`;
    case "wild":
      return "wild";
    case "wild_draw_four":
      return "wild draw four";
  }
}

const SIZES = {
  sm: { box: "h-16 w-11 rounded-lg", center: "text-lg", corner: "text-[8px]", oval: "inset-[3px]", back: "text-[13px]" },
  md: { box: "h-24 w-16 rounded-xl", center: "text-3xl", corner: "text-[11px]", oval: "inset-1.5", back: "text-xl" },
  lg: { box: "h-28 w-20 rounded-xl", center: "text-4xl", corner: "text-xs", oval: "inset-2", back: "text-2xl" },
} as const;

/** The four-color pinwheel that sits on wild cards. */
function WildPinwheel() {
  return (
    <span className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-hidden rounded-[inherit]" aria-hidden>
      <span className="bg-[#d81e18]" />
      <span className="bg-[#f0a800]" />
      <span className="bg-[#1f5fd6]" />
      <span className="bg-[#1f9d3f]" />
    </span>
  );
}

/**
 * A single rendered Uno card with the classic look: a colored body, a diagonal
 * white oval, a big outlined center glyph, mirrored corner indices, and a gloss
 * highlight. Wild cards show the four-color pinwheel (with the chosen color as
 * the body once played).
 */
export function UnoCardView({
  card,
  size = "md",
  selectable,
  selected,
  dimmed,
  onClick,
  className,
}: {
  card: PublicCard | UnoCard;
  size?: keyof typeof SIZES;
  selectable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const s = SIZES[size];
  const isWild = card.color === null;
  const center = faceLabel(card.kind, card.value);
  const corner = cornerLabel(card.kind, card.value);
  const interactive = selectable && !!onClick;
  const inkClass = isWild ? "text-neutral-900" : COLOR_INK[card.color as Exclude<CardColor, null>];

  return (
    <motion.button
      type="button"
      layout
      disabled={!interactive}
      onClick={onClick}
      aria-label={cardAria(card)}
      whileTap={interactive ? { scale: 0.94 } : undefined}
      whileHover={interactive ? { y: -10 } : undefined}
      animate={selected ? { y: -16 } : { y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={cx(
        "relative shrink-0 overflow-hidden border-[3px] border-white font-display font-extrabold shadow-e3 outline-none",
        s.box,
        isWild ? "bg-neutral-900" : COLOR_BG[card.color as Exclude<CardColor, null>],
        interactive && "cursor-pointer ring-brand focus-visible:ring-4 hover:shadow-e4",
        !interactive && "cursor-default",
        selected && "ring-4 ring-brand shadow-e4",
        dimmed && "opacity-70",
        className,
      )}
    >
      {isWild && <WildPinwheel />}

      {/* Diagonal white oval - the signature Uno face plate. */}
      <span
        className={cx(
          "absolute grid place-items-center rounded-[50%] bg-white/95 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]",
          s.oval,
        )}
        style={{ transform: "rotate(-42deg)" }}
        aria-hidden
      >
        {/* Center glyph (un-rotated so it stays upright on the tilted oval). */}
        <span className={cx("leading-none", s.center, inkClass)} style={{ transform: "rotate(42deg)" }}>
          {isWild && card.kind === "wild" ? "" : center}
        </span>
      </span>

      {/* Corner indices: top-left upright, bottom-right mirrored - like a real card. */}
      <span className={cx("absolute left-1 top-0.5 leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]", s.corner)} aria-hidden>
        {corner}
      </span>
      <span className={cx("absolute bottom-0.5 right-1 rotate-180 leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]", s.corner)} aria-hidden>
        {corner}
      </span>

      {/* Gloss: a soft diagonal highlight across the upper-left. */}
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0)_45%)]"
        aria-hidden
      />
    </motion.button>
  );
}

/**
 * Face-down card back: dark body, the diagonal red oval, and the italic "UNO"
 * wordmark - the look everyone recognizes from across the table.
 */
export function UnoCardBack({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden border-[3px] border-white bg-[linear-gradient(150deg,#2a2a2e_0%,#141416_100%)] shadow-e2",
        s.box,
        className,
      )}
      aria-hidden
    >
      {/* A wide red band cutting diagonally across the card - the classic back. */}
      <span
        className="absolute left-1/2 top-1/2 h-[46%] w-[150%] -translate-x-1/2 -translate-y-1/2 bg-[#d81e18] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]"
        style={{ transform: "translate(-50%, -50%) rotate(-32deg)" }}
      />
      {/* The oval wordmark plate, tilted ALONG the band and centered on the card. */}
      <span
        className="absolute grid aspect-[1.7] w-[74%] place-items-center rounded-[50%] bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
        style={{ transform: "rotate(-32deg)" }}
      >
        <span
          className={cx(
            "font-display font-extrabold italic leading-none tracking-tighter text-[#d81e18] drop-shadow-[0_1px_0_rgba(0,0,0,0.15)]",
            s.back,
          )}
        >
          {size === "sm" ? "U" : "UNO"}
        </span>
      </span>
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0)_45%)]"
      />
    </div>
  );
}
