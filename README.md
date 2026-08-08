# 🎉 Party Hub

Play simple, silly, fun **2-player games with a friend far away**. Spin up a private
room, share the link, and play together in real time. First game: **Wordle** (Race
or Co-op, best-of-N), built on a generic game framework so **Uno** and **Guess the
Person** can plug in next.

- **Same word, guaranteed.** Both players always get the *same* Wordle word, and it
  stays the same across refresh and shared-URL redirects — the word is chosen
  deterministically on the server and **never** sent to your browser mid-round
  (so it can't be cheated out of devtools).
- **Refresh-safe.** Close the tab, reopen the link, lose your wifi for a moment —
  you reconnect to the exact same seat with your guesses and the board intact.
- **Polished.** Design-system-driven UI, light/dark themes, tactile Framer Motion
  animations (tile flips, shakes, confetti), colorblind-safe cues, keyboard-first.

---

## Quick start

Requires **Node ≥ 20** and **pnpm** (via Corepack: `corepack enable pnpm`).

```bash
pnpm install

# Terminal 1 — game server on :3001
pnpm dev:server

# Terminal 2 — web app on :5173
pnpm dev:frontend
```

Open http://localhost:5173, pick a nickname, **Create private room**, and share the
`/room/CODE` link (open it in a second browser/tab to be Player 2).

To run both at once: `pnpm dev`.

---

## How to play

1. **Create a room** — choose **Race** (same word, first to solve wins) or **Co-op**
   (one shared board, take turns), and a match length (Single / Best of 3 / Best of 5).
2. **Share the link** — your friend opens it, types a nickname, and they're seated.
3. **Play** — type guesses; you see your opponent's progress as colored blocks (never
   their letters). Win rounds to win the match, then **Play again**.

---

## Monorepo layout

```
packages/
  shared/     TypeScript types + game contract shared by client & server
  server/     Node + Socket.io, authoritative room engine + Wordle module
  frontend/   React + Vite + Tailwind + Framer Motion
```

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it works: determinism, anti-cheat,
  reconnection, the generic game contract.
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — deploy the frontend to Vercel and the server
  to Render or Fly.io.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run server + frontend together |
| `pnpm dev:server` / `pnpm dev:frontend` | Run one side |
| `pnpm build` | Build all packages for production |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Server unit tests (Vitest) |
| `pnpm --filter @party-hub/server run e2e` | Two-client end-to-end smoke test (server must be running) |
| `pnpm wordlist:verify` | Verify the word lists are intact + unchanged |

---

## Verifying the "same word" guarantee yourself

With the server running:

```bash
pnpm --filter @party-hub/server run e2e
```

This drives two real Socket.io clients through a match and asserts: both players get
identical feedback for an identical guess (**same word**), the answer never appears in
a mid-round payload (**anti-cheat**), a reconnect replays prior guesses with the word
unchanged (**refresh-safe**), and both see the same revealed answer when the round ends.

---

## Roadmap

- ✅ **Wordle** — Race + Co-op, best-of-N, deterministic same-word, reconnect
- ⏭️ **Uno** — 2-player, as a `GameModule` on the same engine
- ⏭️ **Guess the Person** — parametric animated SVG avatars + attribute questions
- 💤 Deferred: Skribbl (canvas + chat + timers), Pizzeria
