/**
 * End-to-end smoke test over the real Socket.io protocol. Proves the user's
 * core requirements against a running server (default http://localhost:3001):
 *
 *   1. SAME WORD for both players — an identical guess yields identical feedback.
 *   2. ANTI-CHEAT — the answer is never present in a mid-round payload.
 *   3. REFRESH-SAFE — a reconnect (same playerId) replays guesses + feedback,
 *      and the word is unchanged (same feedback for the same guess).
 *   4. Both players see the SAME revealed answer once the round ends.
 *
 * Run: node packages/server/scripts/e2e-smoke.mjs  (server must be running)
 */
import { io } from "socket.io-client";

const URL = process.env.SERVER_URL ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  if (!cond) failures++;
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** A thin client wrapper that always tracks the latest room:state snapshot. */
function makeClient(playerId, nickname, roomCode) {
  const socket = io(URL, {
    transports: ["websocket"],
    forceNew: true,
    auth: { playerId, nickname, roomCode },
  });
  const client = { socket, state: null, playerId };
  socket.on("room:state", (s) => (client.state = s));
  return client;
}

function waitConnect(client) {
  return new Promise((resolve, reject) => {
    client.socket.on("connect", resolve);
    client.socket.on("connect_error", reject);
  });
}

function emitAck(client, event, req) {
  return new Promise((resolve) => client.socket.emit(event, req, resolve));
}

/** Wait until predicate(client.state) is truthy, or time out. */
async function waitFor(client, predicate, label, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (client.state && predicate(client.state)) return client.state;
    await sleep(25);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function guess(client, word) {
  const res = await emitAck(client, "game:action", { type: "submit_guess", payload: { guess: word } });
  return res;
}

async function main() {
  console.log(`\nParty Hub E2E smoke test → ${URL}\n`);

  // --- Player A creates a room ---
  const A = makeClient("e2e-player-A", "Alice");
  await waitConnect(A);
  const created = await emitAck(A, "room:create", { gameId: "wordle", wordle: { mode: "race", bestOf: 3 } });
  check("A creates room", created.ok, created.ok ? `code=${created.data.code}` : JSON.stringify(created.error));
  if (!created.ok) throw new Error("cannot continue without a room");
  const code = created.data.code;

  // A must explicitly join the room it created (create doesn't seat you).
  const aJoin = await emitAck(A, "room:join", { code });
  check("A joins its own room", aJoin.ok);

  // --- NICKNAME GATE: a shared-link visitor with NO nickname must be rejected
  // by the handshake auto-join (not silently seated as "Player"). ---
  {
    const noName = makeClient("e2e-no-nickname", "", code);
    let gateErr = null;
    noName.socket.on("error", (e) => (gateErr = e));
    await waitConnect(noName);
    await sleep(400);
    check("nickname-less auto-join is rejected", gateErr?.code === "NICKNAME_REQUIRED", JSON.stringify(gateErr));
    check("nickname-less visitor is NOT seated", noName.state === null);
    // And A still sees only itself — the ghost never took a seat.
    check("room still has just the creator", A.state?.players.length === 1, `players=${A.state?.players.length}`);
    noName.socket.disconnect();
  }

  // --- Player B joins via handshake auto-join (like opening the shared link) ---
  const B = makeClient("e2e-player-B", "Bob", code);
  await waitConnect(B);
  await waitFor(B, (s) => s.players.length === 2, "B sees 2 players");
  await waitFor(A, (s) => s.players.length === 2, "A sees 2 players");
  check("both players seated", A.state.players.length === 2 && B.state.players.length === 2);
  check("game started (in_game)", A.state.phase === "in_game", `phase=${A.state.phase}`);
  check("A and B have distinct seats", A.state.yourSeat !== B.state.yourSeat, `${A.state.yourSeat} vs ${B.state.yourSeat}`);

  // --- SAME WORD: identical guess → identical feedback ---
  const probe = "CRANE";
  const gA = await guess(A, probe);
  check("A's probe guess accepted", gA.ok, gA.ok ? "" : JSON.stringify(gA.error));
  await sleep(300); // stay under the guess rate limit
  const gB = await guess(B, probe);
  check("B's probe guess accepted", gB.ok, gB.ok ? "" : JSON.stringify(gB.error));

  await waitFor(A, (s) => s.game?.self.guesses.length >= 1, "A feedback recorded");
  await waitFor(B, (s) => s.game?.self.guesses.length >= 1, "B feedback recorded");
  const fbA = JSON.stringify(A.state.game.self.feedback[0]);
  const fbB = JSON.stringify(B.state.game.self.feedback[0]);
  check("SAME WORD — identical guess yields identical feedback", fbA === fbB, `${fbA} vs ${fbB}`);

  // --- ANTI-CHEAT: answer not revealed mid-round ---
  check("A payload hides answer mid-round", A.state.game.revealedAnswer === null);
  check("B payload hides answer mid-round", B.state.game.revealedAnswer === null);

  // --- REFRESH-SAFE: A disconnects and reconnects with the same playerId ---
  A.socket.disconnect();
  await sleep(300);
  const A2 = makeClient("e2e-player-A", "Alice", code);
  await waitConnect(A2);
  const synced = await emitAck(A2, "room:sync");
  check("A reconnect + room:sync ok", synced.ok);
  if (synced.ok) A2.state = synced.data;
  await waitFor(A2, (s) => s.game?.self.guesses.length >= 1, "A2 replayed guesses");
  const replayedGuess = A2.state.game.self.guesses[0];
  const replayedFb = JSON.stringify(A2.state.game.self.feedback[0]);
  check("REFRESH-SAFE — prior guess replayed", replayedGuess === probe, `got ${replayedGuess}`);
  check("REFRESH-SAFE — same word after reconnect (feedback identical)", replayedFb === fbA);

  // --- Drive the round to completion → both see the SAME revealed answer ---
  const pool = ["SLATE", "MOUNT", "BRICK", "FLUID", "GHOST", "PLUMB", "WORDY", "JUMPY"];
  let pi = 0;
  // Each player already used 1 guess (CRANE). Feed distinct valid words until the
  // round ends (someone solves, or both exhaust 6 guesses).
  while (!A2.state.game.roundStatus || A2.state.game.roundStatus !== "over") {
    if (A2.state.game.self.status === "playing") {
      const w = pool[pi % pool.length];
      await guess(A2, w);
      await sleep(300);
    }
    if (B.state.game.self.status === "playing") {
      const w = pool[(pi + 3) % pool.length];
      await guess(B, w);
      await sleep(300);
    }
    pi++;
    if (pi > 12) break; // safety
  }
  await waitFor(A2, (s) => s.game?.roundStatus === "over", "round over (A2)");
  await waitFor(B, (s) => s.game?.roundStatus === "over", "round over (B)");
  const ansA = A2.state.game.revealedAnswer;
  const ansB = B.state.game.revealedAnswer;
  check("round ended for both", A2.state.game.roundStatus === "over" && B.state.game.roundStatus === "over");
  check("SAME revealed answer for both", ansA && ansA === ansB, `${ansA} vs ${ansB}`);
  check("revealed answer is a 5-letter word", /^[A-Z]{5}$/.test(ansA ?? ""), ansA ?? "null");

  // Whoever did NOT win still sees the answer (feature #3).
  const aWon = A2.state.game.self.status === "won";
  const bWon = B.state.game.self.status === "won";
  const loser = aWon && !bWon ? B : bWon && !aWon ? A2 : null;
  if (loser) {
    check("LOSER still sees the revealed answer", loser.state.game.revealedAnswer === ansA);
  }

  // --- READY GATE (feature #1): round advances only when BOTH are ready ---
  const beforeRound = A2.state.game.roundNumber;
  await emitAck(A2, "game:action", { type: "next_round" });
  await sleep(200);
  check(
    "one ready → round does NOT advance",
    A2.state.game.roundNumber === beforeRound && A2.state.game.youReady === true,
    `round=${A2.state.game.roundNumber} youReady=${A2.state.game.youReady}`,
  );
  await waitFor(B, (s) => s.game.opponentReady === true, "B sees A ready");
  check("opponent readiness is visible to the other player", B.state.game.opponentReady === true);
  await emitAck(B, "game:action", { type: "next_round" });
  await waitFor(A2, (s) => s.game.roundNumber === beforeRound + 1, "round advanced after both ready");
  check(
    "both ready → round advances to a fresh board",
    A2.state.game.roundNumber === beforeRound + 1 &&
      A2.state.game.roundStatus === "active" &&
      A2.state.game.self.guesses.length === 0,
  );

  // --- HINT (feature #2): unlocks on the last two guesses, reveals ONE letter
  check("hint locked before the last two guesses", A2.state.game.self.canHint === false);
  const hintPool = ["SLATE", "MOUNT", "BRICK", "FLUID", "GHOST", "PLUMB"];
  let hi = 0;
  // Feed distinct valid non-solving guesses until we've used 4 (hint unlocks),
  // stopping if the round happens to end.
  while (A2.state.game.self.guesses.length < 4 && A2.state.game.self.status === "playing") {
    await guess(A2, hintPool[hi % hintPool.length]);
    await sleep(250);
    hi++;
    if (hi > 8) break;
  }
  if (A2.state.game.self.status === "playing") {
    check("hint unlocks on the last two guesses", A2.state.game.self.canHint === true);
    const hintRes = await emitAck(A2, "game:action", { type: "hint" });
    check("hint request accepted", hintRes.ok);
    await waitFor(A2, (s) => s.game.self.hint !== null, "hint delivered");
    const h = A2.state.game.self.hint;
    check("hint reveals exactly one letter + position", !!h && /^[A-Z]$/.test(h.letter) && h.index >= 0 && h.index < 5, JSON.stringify(h));
    // Anti-cheat: the opponent must NOT receive A's hint, and no full word leaks.
    check("opponent never receives the hint", B.state.game.self.hint === null);
    check("hint payload does not leak the full answer (still 1 letter)", A2.state.game.revealedAnswer === null);
  }

  A2.socket.disconnect();
  B.socket.disconnect();

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n💥 E2E harness error:", err.message);
  process.exit(1);
});
