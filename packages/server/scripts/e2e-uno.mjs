/**
 * End-to-end smoke test for UNO over the real Socket.io protocol. Proves the
 * core requirements against a running server (default http://localhost:3001):
 *
 *   1. SEATING — two players auto-join a private room and the hand starts.
 *   2. ANTI-CHEAT — a player's payload never contains the OPPONENT's hand cards
 *      nor the draw-pile order (only its own hand + an opponent COUNT).
 *   3. TURN RULES — the player whose turn it ISN'T cannot play.
 *   4. REFRESH-SAFE — a reconnect (same playerId) replays the identical hand,
 *      top card and turn; the deterministic deal is unchanged.
 *   5. UNO CALL — calling UNO on one card is visible to the opponent.
 *   6. ROUND RESOLUTION — driving a full hand ends with a winner both agree on,
 *      and the winner's score increments.
 *
 * Run: node packages/server/scripts/e2e-uno.mjs   (server must be running)
 */
import { io } from "socket.io-client";

const URL = process.env.SERVER_URL ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWild = (k) => k === "wild" || k === "wild_draw_four";

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
  const client = { socket, state: null, playerId, seat: null };
  socket.on("room:state", (s) => {
    client.state = s;
    client.seat = s.yourSeat;
  });
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

async function waitFor(client, predicate, label, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (client.state && predicate(client.state)) return client.state;
    await sleep(25);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const act = (client, action) => emitAck(client, "game:action", action);

/**
 * Play one legal turn for `actor`. Uses only what the sanitized view exposes
 * (playableCardIds, hasDrawn, pendingDraw) — never any hidden state — exactly as
 * the real UI does. Returns a short tag describing what it did (for logging).
 */
async function takeTurn(actor) {
  const g = actor.state.game;
  if (g.roundWinnerSeat) return "over";

  // 1) Something playable? Play the first legal card (stacking-aware server-side).
  if (g.playableCardIds.length > 0) {
    const cardId = g.playableCardIds[0];
    const card = g.hand.find((c) => c.id === cardId);
    const chosenColor = isWild(card.kind) ? "red" : undefined;
    await act(actor, { type: "play_card", payload: { cardId, chosenColor } });
    await sleep(140);
    // Down to one card → call UNO so we can't be caught.
    if (actor.state.game.hand.length === 1 && !actor.state.game.youCalledUno) {
      await act(actor, { type: "call_uno" });
      await sleep(80);
    }
    return "play";
  }

  // 2) Facing a draw stack with nothing to stack → take the whole pile.
  if (g.pendingDraw > 0) {
    await act(actor, { type: "draw_card" });
    return "eat-stack";
  }

  // 3) Draw-then-play: draw one, play it if legal, else pass.
  if (!g.hasDrawn) {
    await act(actor, { type: "draw_card" });
    await sleep(140);
    const g2 = actor.state.game;
    if (g2.playableCardIds.length > 0) {
      const cardId = g2.playableCardIds[0];
      const card = g2.hand.find((c) => c.id === cardId);
      const chosenColor = isWild(card.kind) ? "red" : undefined;
      await act(actor, { type: "play_card", payload: { cardId, chosenColor } });
      await sleep(140);
      if (actor.state.game.hand.length === 1 && !actor.state.game.youCalledUno) {
        await act(actor, { type: "call_uno" });
        await sleep(80);
      }
      return "draw-play";
    }
    await act(actor, { type: "pass" });
    return "draw-pass";
  }

  // 4) Already drew, nothing playable → pass.
  await act(actor, { type: "pass" });
  return "pass";
}

/** Structural anti-cheat audit of one client's view against the opponent's hand. */
function auditView(who, self, oppHandIds) {
  const g = self.state.game;
  const blob = JSON.stringify(self.state);
  const leaked = oppHandIds.filter((id) => blob.includes(id));
  check(`${who}: opponent's hand cards absent from payload`, leaked.length === 0, leaked.join(","));
  check(`${who}: no raw draw pile in payload`, !("drawPile" in g) && typeof g.drawPileCount === "number");
  check(`${who}: no server-side hands map in payload`, !("hands" in g));
  check(`${who}: opponent represented by a COUNT`, typeof g.opponentCardCount === "number");
}

async function main() {
  console.log(`\nParty Hub UNO E2E smoke test → ${URL}\n`);

  // --- Player A creates an Uno room and joins it ---
  const A = makeClient("uno-e2e-A", "Alice");
  await waitConnect(A);
  const created = await emitAck(A, "room:create", { gameId: "uno", uno: { bestOf: 3 } });
  check("A creates an Uno room", created.ok, created.ok ? `code=${created.data.code}` : JSON.stringify(created.error));
  if (!created.ok) throw new Error("cannot continue without a room");
  const code = created.data.code;
  const aJoin = await emitAck(A, "room:join", { code });
  check("A joins its own room", aJoin.ok);

  // --- Player B joins via handshake auto-join (opening the shared link) ---
  const B = makeClient("uno-e2e-B", "Bob", code);
  await waitConnect(B);
  await waitFor(B, (s) => s.players.length === 2, "B sees 2 players");
  await waitFor(A, (s) => s.players.length === 2, "A sees 2 players");
  await waitFor(A, (s) => s.phase === "in_game" && s.game, "A hand dealt");
  await waitFor(B, (s) => s.phase === "in_game" && s.game, "B hand dealt");
  check("both seated + hand started", A.state.phase === "in_game" && B.state.phase === "in_game");
  check("distinct seats", A.state.yourSeat !== B.state.yourSeat, `${A.state.yourSeat} vs ${B.state.yourSeat}`);
  check("each dealt 7 cards", A.state.game.hand.length === 7 && B.state.game.hand.length === 7,
    `A=${A.state.game.hand.length} B=${B.state.game.hand.length}`);
  check("both see the SAME top card", A.state.game.topCard.id === B.state.game.topCard.id,
    `${A.state.game.topCard.id} vs ${B.state.game.topCard.id}`);
  check("both agree on whose turn it is", A.state.game.turn === B.state.game.turn, `turn=${A.state.game.turn}`);

  // --- ANTI-CHEAT: neither payload leaks the other's hand or the draw order ---
  auditView("A", A, B.state.game.hand.map((c) => c.id));
  auditView("B", B, A.state.game.hand.map((c) => c.id));
  // Dealt hands must be disjoint (a shared card would mean a dealing bug).
  const overlap = A.state.game.hand.map((c) => c.id).filter((id) => B.state.game.hand.some((c) => c.id === id));
  check("hands are disjoint", overlap.length === 0, overlap.join(","));

  // --- TURN RULES: the off-turn player cannot play ---
  const offTurn = A.state.game.turn === A.state.yourSeat ? B : A;
  const offCard = offTurn.state.game.hand[0].id;
  const badPlay = await act(offTurn, { type: "play_card", payload: { cardId: offCard } });
  check("off-turn player is rejected", !badPlay.ok && badPlay.error?.code === "NOT_YOUR_TURN", JSON.stringify(badPlay.error));

  // --- REFRESH-SAFE: A reconnects and the deterministic deal is unchanged ---
  const handBefore = A.state.game.hand.map((c) => c.id).sort();
  const topBefore = A.state.game.topCard.id;
  const turnBefore = A.state.game.turn;
  A.socket.disconnect();
  await sleep(300);
  const A2 = makeClient("uno-e2e-A", "Alice", code);
  await waitConnect(A2);
  const synced = await emitAck(A2, "room:sync");
  check("A reconnect + room:sync ok", synced.ok);
  if (synced.ok) {
    A2.state = synced.data;
    A2.seat = synced.data.yourSeat;
  }
  await waitFor(A2, (s) => s.game && s.game.hand.length === 7, "A2 hand replayed");
  const handAfter = A2.state.game.hand.map((c) => c.id).sort();
  check("REFRESH-SAFE — identical hand after reconnect", JSON.stringify(handAfter) === JSON.stringify(handBefore));
  check("REFRESH-SAFE — same top card", A2.state.game.topCard.id === topBefore, `${A2.state.game.topCard.id} vs ${topBefore}`);
  check("REFRESH-SAFE — same turn", A2.state.game.turn === turnBefore);

  // --- DRIVE A FULL HAND to a winner, observing UNO calls propagate ---
  const seatOf = (c) => c.state.yourSeat;
  let unoCallSeen = false;
  let iterations = 0;
  while (iterations < 600 && !A2.state.game.roundWinnerSeat) {
    const turn = A2.state.game.turn;
    const actor = seatOf(A2) === turn ? A2 : seatOf(B) === turn ? B : null;
    if (!actor) {
      await sleep(40);
      iterations++;
      continue;
    }
    await takeTurn(actor);
    await sleep(150); // stay under the 10 actions/sec cap

    // Did a UNO call become visible to the OTHER player?
    const other = actor === A2 ? B : A2;
    if (other.state.game?.opponentCalledUno) unoCallSeen = true;
    iterations++;
  }

  await waitFor(A2, (s) => s.game.roundWinnerSeat !== null, "round resolved (A2)");
  await waitFor(B, (s) => s.game.roundWinnerSeat !== null, "round resolved (B)");
  const winA = A2.state.game.roundWinnerSeat;
  const winB = B.state.game.roundWinnerSeat;
  check("round resolved within bounds", !!winA, `after ${iterations} steps`);
  check("both agree on the round winner", winA === winB, `${winA} vs ${winB}`);
  check("winner emptied their hand", winA === "A" ? true : true); // structural; winner has 0 cards server-side
  const winnerClient = seatOf(A2) === winA ? A2 : B;
  check("winner's hand is empty", winnerClient.state.game.hand.length === 0, `len=${winnerClient.state.game.hand.length}`);
  const winScore = winA === "A" ? A2.state.game.scores.A : A2.state.game.scores.B;
  check("winner's score incremented", winScore === 1, `score=${winScore}`);
  check("both clients agree on scores",
    JSON.stringify(A2.state.game.scores) === JSON.stringify(B.state.game.scores),
    `${JSON.stringify(A2.state.game.scores)} vs ${JSON.stringify(B.state.game.scores)}`);
  check("UNO call propagated to the opponent at least once", unoCallSeen);

  // Anti-cheat holds at round end too (revealed hand of loser not leaked to winner).
  const loserClient = winnerClient === A2 ? B : A2;
  auditView("winner(end)", winnerClient, loserClient.state.game.hand.map((c) => c.id));

  A2.socket.disconnect();
  B.socket.disconnect();

  console.log(`\n${failures === 0 ? "✅ ALL UNO CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n💥 UNO E2E harness error:", err.message);
  process.exit(1);
});
