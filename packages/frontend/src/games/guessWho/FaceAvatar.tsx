import type { Person } from "@party-hub/shared";

/**
 * A fully parameterized SVG portrait. Every questionable attribute of a
 * {@link Person} maps to a visible feature here, so the art is GROUND TRUTH for
 * the game - never a stock image that could drift out of sync with the data the
 * server answers questions from. `hairColor` is cosmetic (drives hair/brows/beard
 * tint) and is deliberately never asked about.
 */

const SKIN: Record<Person["skinTone"], string> = {
  black: "#6b4327",
  olive: "#cd965c",
  white: "#f1c9a2",
};

/** A darker shade of each skin tone for the nose/shading line. */
const SKIN_SHADE: Record<Person["skinTone"], string> = {
  black: "#4f3019",
  olive: "#a9723f",
  white: "#d9a878",
};

const EYE: Record<Person["eyeColor"], string> = {
  black: "#26292f",
  brown: "#6b4327",
  green: "#3fa06a",
  blue: "#4a86d6",
};

/** Deterministic accent palettes keyed off the person id (cosmetic only). */
const SHIRTS = ["#5b8def", "#e8657f", "#43b17a", "#e0a23b", "#9b6dd6", "#3fb6c4", "#e07b53"];
const HATS = ["#d1493f", "#3f7fd6", "#43b17a", "#e0a23b", "#7a5bd6", "#2f9d8f"];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function FaceAvatar({ person, className }: { person: Person; className?: string }) {
  const skin = SKIN[person.skinTone];
  const skinShade = SKIN_SHADE[person.skinTone];
  const eye = EYE[person.eyeColor];
  const hair = person.hairColor;
  const h = hashCode(person.id);
  const shirt = SHIRTS[h % SHIRTS.length];
  const hat = HATS[(h >> 3) % HATS.length];

  const female = person.gender === "female";
  const lip = female ? "#c65b6b" : "#a9583f";
  const hasGlasses = person.accessories.includes("glasses");
  const hasHat = person.accessories.includes("hat");
  const hasJewelry = person.accessories.includes("jewelry");
  const hasTopHair = person.hairLength !== "bald";
  const isLong = person.hairLength === "long";

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={person.name}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* torso / shoulders */}
      <path d="M12,100 C12,80 30,72 50,72 C70,72 88,80 88,100 Z" fill={shirt} />

      {/* Long hair: a full mass BEHIND the head that frames the face and flows
          down past the shoulders on both sides. Drawn before the head/neck so the
          face sits on top; only the crown, side locks, and shoulder-length flow
          show through. The inner curve tucks under the chin (hidden by the head),
          which keeps the silhouette reading as hair rather than a floating blob. */}
      {isLong && (
        <path
          d="M22,40 C12,60 15,86 29,92 C31,70 30,52 40,42
             C40,52 44,58 50,58 C56,58 60,52 60,42
             C70,52 69,70 71,92 C85,86 88,60 78,40
             C78,22 65,17 50,17 C35,17 22,22 22,40 Z"
          fill={hair}
        />
      )}

      {/* neck */}
      <rect x="44" y="58" width="12" height="18" rx="5" fill={skinShade} />

      {/* head */}
      <ellipse cx="50" cy="44" rx="22" ry="25" fill={skin} />

      {/* ears */}
      <circle cx="28" cy="47" r="4.5" fill={skin} />
      <circle cx="72" cy="47" r="4.5" fill={skin} />

      {/* JEWELRY = a matching set of earrings + necklace, always drawn together.
          Earrings are studs on each earlobe; the necklace is a chain with a
          pendant resting on the collarbone. Rendered here (after ears, before the
          top hair) so studs sit on the lobes and the chain sits over the neck. */}
      {hasJewelry && (
        <>
          {/* earrings */}
          <circle cx="28" cy="53.5" r="2" fill="#f2cf4d" stroke="#c9a233" strokeWidth="0.5" />
          <circle cx="72" cy="53.5" r="2" fill="#f2cf4d" stroke="#c9a233" strokeWidth="0.5" />
          {/* necklace chain + pendant */}
          <path
            d="M39,73 Q50,84 61,73"
            stroke="#f2cf4d"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="50" cy="82.5" r="2.6" fill="#f2cf4d" stroke="#c9a233" strokeWidth="0.6" />
        </>
      )}

      {/* hair on top (short + long share the crown; long adds the back layer above) */}
      {hasTopHair && (
        <path
          d="M27,45 C25,24 40,18 50,18 C60,18 75,24 73,45 C69,34 61,30 50,30 C39,30 31,34 27,45 Z"
          fill={hair}
        />
      )}

      {/* eyebrows (hair-colored; lighter stroke for female) */}
      <path
        d={`M35,37 Q41,${female ? 35 : 34} 47,37`}
        stroke={hair}
        strokeWidth={female ? 1.8 : 2.6}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M53,37 Q59,${female ? 35 : 34} 65,37`}
        stroke={hair}
        strokeWidth={female ? 1.8 : 2.6}
        fill="none"
        strokeLinecap="round"
      />

      {/* eyes */}
      {[41, 59].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="44" rx="5.2" ry="3.6" fill="#ffffff" />
          <circle cx={cx} cy="44" r="2.8" fill={eye} />
          <circle cx={cx} cy="44" r="1.3" fill="#161616" />
          <circle cx={cx + 1} cy="43" r="0.7" fill="#ffffff" />
          {female && (
            <path
              d={`M${cx - 5.4},43 Q${cx - 5.6},41 ${cx - 3.8},40.6`}
              stroke="#3a2a20"
              strokeWidth="0.8"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </g>
      ))}

      {/* nose */}
      <path
        d="M50,45 L47,54 Q50,56 53,54"
        stroke={skinShade}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* mouth - fuller filled lips for female, a simple line otherwise */}
      {female ? (
        <path
          d="M42,60 Q46,57.5 50,58.5 Q54,57.5 58,60 Q54,64 50,64 Q46,64 42,60 Z"
          fill={lip}
        />
      ) : (
        <path d="M43,60 Q50,63.5 57,60" stroke={lip} strokeWidth="2" fill="none" strokeLinecap="round" />
      )}

      {/* facial hair */}
      {person.facialHair && (
        <>
          <path
            d="M29,44 C29,66 40,72 50,72 C60,72 71,66 71,44 C71,58 62,63 50,63 C38,63 29,58 29,44 Z"
            fill={hair}
            opacity="0.95"
          />
          <path d="M42,57 Q50,61 58,57 Q50,55 42,57 Z" fill={hair} />
        </>
      )}

      {/* glasses */}
      {hasGlasses && (
        <g stroke="#2c2c33" strokeWidth="1.8" fill="rgba(255,255,255,0.14)" strokeLinecap="round">
          <rect x="33" y="39" width="15" height="11" rx="5" />
          <rect x="52" y="39" width="15" height="11" rx="5" />
          <line x1="48" y1="44" x2="52" y2="44" />
          <line x1="33" y1="42" x2="27" y2="41" />
          <line x1="67" y1="42" x2="73" y2="41" />
        </g>
      )}

      {/* hat sits on top of the hair */}
      {hasHat && (
        <g>
          <path d="M27,43 C27,20 73,20 73,43 Z" fill={hat} />
          <path d="M19,43 Q50,34 81,43 Q50,50 19,43 Z" fill={hat} />
          <path d="M27,43 C27,20 73,20 73,43 Z" fill="rgba(0,0,0,0.12)" />
        </g>
      )}
    </svg>
  );
}
