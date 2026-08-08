# Architecture

Party Hub is a **server-authoritative**, real-time 2-player game platform. The server
owns all game truth; clients render sanitized views and dispatch actions. This is what
makes the Wordle guarantees (same word, refresh-safe, anti-cheat) hold.

```
┌─────────────┐   Socket.io (WebSocket)   ┌──────────────────────────┐
│  Browser A  │◀─────────────────────────▶│                          │
├─────────────┤   handshake: {playerId,   │   Node + Socket.io        │
│  Browser B  │◀───  nickname, roomCode}   │   RoomManager (in-memory) │
└─────────────┘                            │   └─ GameModule (Wordle)  │
      React + Vite                         └──────────────────────────┘
   design system + motion                    authoritative state + secrets
```

## Packages

- **`@party-hub/shared`** — the wire contract: socket event names + payload types
  (`events.ts`), the room snapshot (`room.ts`), the generic `GameModule` interface
  (`gameContract.ts`), the error taxonomy (`errors.ts`), Wordle domain types
  (`games/wordle.ts`), room-code rules (`roomCode.ts`), and the deterministic hash
  primitives (`cyrb53.ts`). Both client and server import from here, so payloads can
  never drift.
- **`@party-hub/server`** — the room engine (`rooms.ts`), socket bootstrap + validation
  (`index.ts`), game registry (`registry.ts`), and the Wordle module + word lists
  (`games/wordle/`).
- **`@party-hub/frontend`** — React app: networking (`net/`), design system
  (`design-system/`), pages (`pages/`), and the Wordle renderer (`games/wordle/`).

---

## The "same word" guarantee (the core requirement)

Three properties, by construction:

### 1. Same word for both players — deterministic, server-side only
The answer for a round is computed **only on the server** from a stable seed:

```
seed  = `${roomCode}#${difficulty}#v${WORDLIST_VERSION}#cycle${cycle}`
pool  = shuffled(answerPool, seed)          // deterministic Fisher–Yates
answer = pool[(roundNumber - 1) % pool.length]
```

- `cyrb53` is a small hash with **identical output in Node and the browser** — no
  `Math.random`, no `Date`. Given the same inputs it always yields the same word.
- The **round number is the user's "stages 1, 2, 3, 4…"** — round N is always the same
  word for a given room, forever.
- Words don't repeat within a cycle: we walk a seeded shuffle of the pool and only
  reshuffle (new `cycle`) once it's exhausted.

### 2. Anti-cheat — the client never receives the answer mid-round
`sanitizeFor(state, playerId)` projects the full server state down to a per-player
view. `revealedAnswer` is `null` until the round is over. On each guess the server
recomputes green/yellow/gray feedback from scratch and returns **only** the feedback.
Your opponent's board is sent as **colors only, never letters**. Inspecting devtools
or network traffic reveals nothing.

### 3. Refresh-safe — reconnect replays everything
Identity is login-free: a UUID `playerId` is generated once and stored in
`localStorage`, sent in the Socket.io handshake `auth`. On (re)connect the server
finds your existing seat and sends a full `room:state` snapshot — your guesses, your
feedback, the opponent's progress, scores, and round/match phase. Because the word is
recomputed deterministically, it's always the **same word**. If you drop, your seat is
**reserved for a grace window** (default 45s) before it's freed.

### Determinism invariant
Word-list files are **immutable and versioned**. `WORDLIST_VERSION` is folded into the
seed, and a startup hash log + `pnpm wordlist:verify` CI check guard against accidental
reordering (which would shift indices and change words on reconnect). To change words,
publish a *new version* — never edit in place.

### Duplicate-letter feedback
Feedback uses the classic Wordle "letter budget": mark greens first (setting the
per-letter budget from non-green answer slots), then allocate remaining budget to
yellows left-to-right; the rest are gray. This is the #1 correctness gotcha and has
dedicated unit tests (e.g. `LLAMA` vs `LEVEL` → `GYBBB`).

---

## Room engine & lifecycle

`RoomManager` keeps rooms in an in-memory `Map` (sufficient for a single instance;
swap in Redis only if we ever scale horizontally). Each room holds its phase, players
(by `playerId`), seat assignments, the chosen `GameModule`, and the module's private
state.

Room phases: `waiting → in_game → round_over → game_over` (a rematch resets to a fresh
match). Rooms have 6-character codes from an unambiguous alphabet (no `O/0/I/1/L`),
regenerated on collision, and idle rooms are swept after a TTL.

**Reconnection:** disconnect starts a grace timer that reserves the seat; reconnect
within the window cancels it and replays state; if it lapses, the seat is freed and the
opponent is notified.

---

## The generic game contract

One canonical action event — **`game:action` `{ type, payload }`** — carries every
game-specific move, so adding a game needs **no new socket events**. Each game is a
`GameModule<S, A, V>`:

```ts
interface GameModule<S, A, V> {
  id: GameId;
  createInitialState(ctx): S;                     // fresh match
  reduce(state, action, playerId, ctx): ReduceResult<S>;  // apply a move (pure)
  sanitizeFor(state, playerId, ctx): V;           // strip secrets per player
  phaseOf(state): RoomPhase;                       // state → lifecycle
  isValidAction(action): action is A;              // runtime guard
}
```

The engine calls `reduce`, then broadcasts each player their **sanitized** view. Wordle
proves the contract; Uno and Guess-the-Person implement the same interface and register
in `registry.ts`.

### Socket event catalog (`shared/events.ts`)
- **C→S:** `room:create`, `room:join`, `room:rematch`, `game:action`,
  `room:sync`, `ping` — all with ack callbacks returning a `Result<T>` envelope.
  (Leaving a room is passive: a disconnect reserves the seat for a grace window,
  then frees it — there is no explicit `room:leave`.)
- **S→C:** `room:state` (authoritative snapshot — used for join *and* reconnect),
  `room:notice` (presence), `game:event` (transient moments: round result, confetti),
  `error`.

> **Protocol note:** no-payload events (`room:sync`, `room:rematch`) are typed
> `(ack) => …`. The client's `emitAck` omits the payload arg entirely for these so the
> ack lands in the first position; the server also defensively resolves the ack as the
> last function argument. A mismatch here previously crashed the process — it's now
> covered by the E2E smoke test.

---

## Resilience & safety

- **Validation:** every client payload is validated with `zod` at the socket boundary;
  the game module also runtime-guards its own actions (`isValidAction`).
- **Rate limiting:** sliding-window limiters on guesses, room creates, and joins.
- **CORS allow-list:** only configured origins may connect.
- **Process guard:** top-level `uncaughtException` / `unhandledRejection` handlers so a
  single bad message can never take down every active room.

---

## Frontend

- **Networking** (`net/`): a singleton socket with handshake auth, a promisified
  emit-with-ack, and the `useRoom` hook that owns connection status, the authoritative
  room snapshot, heartbeat, and resync-on-reconnect.
- **Design system** (`design-system/`): CSS-variable light/dark tokens, Button/Card/
  Input/Toast/PlayerBadge/RoomCodePill primitives, theme provider + toggle.
- **Wordle renderer** (`games/wordle/`): board with 3D flip reveals, on-screen +
  physical keyboard with per-key color state, opponent progress (colors only), and
  round/match overlays with confetti. All motion respects `prefers-reduced-motion`;
  color is never the only signal (colorblind-safe glyphs).

---

## Testing

- **Unit (Vitest):** duplicate-letter feedback correctness, `selectWord` determinism
  (including stability across a simulated reload), and the Wordle module (race/co-op
  resolution, best-of-N scoring, answer-never-leaked).
- **End-to-end smoke:** `scripts/e2e-smoke.mjs` drives two real Socket.io clients and
  asserts same-word, anti-cheat, refresh-safe reconnect, and matching revealed answers.
