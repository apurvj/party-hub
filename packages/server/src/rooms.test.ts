import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORDLE_CONFIG } from "@party-hub/shared";
import { RoomManager, type RoomEmitter } from "./rooms.js";
import type { GameConfigs } from "./registry.js";
import type { UnoState } from "./games/uno/module.js";

const CONFIGS: GameConfigs = { wordle: DEFAULT_WORDLE_CONFIG, uno: { bestOf: 1 } };

function silentEmitter(): RoomEmitter {
  return { emitRoomState: vi.fn(), emitGameEvent: vi.fn(), emitNotice: vi.fn() };
}

/** Seat two players into a fresh Uno room; returns the manager + room code. */
function twoPlayerUnoRoom(mgr: RoomManager) {
  const room = mgr.createRoom("uno", CONFIGS);
  mgr.join(room.code, "P_A", "Alice");
  mgr.join(room.code, "P_B", "Bob");
  return room.code;
}

describe("RoomManager — seating + join", () => {
  let mgr: RoomManager;
  beforeEach(() => (mgr = new RoomManager(silentEmitter())));

  it("seats two players and starts the game", () => {
    const code = twoPlayerUnoRoom(mgr);
    const snap = mgr.getSnapshot(code, "P_A")!;
    expect(snap.phase).toBe("in_game");
    expect(snap.players.length).toBe(2);
    expect(snap.yourSeat).toBe("A");
    expect(mgr.getSnapshot(code, "P_B")!.yourSeat).toBe("B");
  });

  it("rejects a third player with ROOM_FULL", () => {
    const code = twoPlayerUnoRoom(mgr);
    const res = mgr.join(code, "P_C", "Carol");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ROOM_FULL");
  });

  it("join on an unknown code is ROOM_NOT_FOUND", () => {
    const res = mgr.join("ZZZZZZ", "P_A", "Alice");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("reconnect (same playerId) reclaims the seat and replays state", () => {
    const code = twoPlayerUnoRoom(mgr);
    const again = mgr.join(code, "P_A", "Alice");
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.reconnected).toBe(true);
      expect(again.state.yourSeat).toBe("A");
    }
  });
});

describe("RoomManager — action gating", () => {
  let mgr: RoomManager;
  beforeEach(() => (mgr = new RoomManager(silentEmitter())));

  it("rejects actions from a non-member", () => {
    const code = twoPlayerUnoRoom(mgr);
    const res = mgr.action(code, "P_STRANGER", { type: "draw_card" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_IN_ROOM");
  });

  it("rejects an unknown action type as INVALID_ACTION", () => {
    const code = twoPlayerUnoRoom(mgr);
    const res = mgr.action(code, "P_A", { type: "definitely_not_a_move" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ACTION");
  });

  it("does NOT mutate committed state when reduce returns an error", () => {
    const code = twoPlayerUnoRoom(mgr);
    const before = JSON.stringify(mgr.getRoom(code)!.gameState);
    // Off-turn player (B) tries to draw — rejected, no state change.
    const res = mgr.action(code, "P_B", { type: "draw_card" });
    expect(res.ok).toBe(false);
    const after = JSON.stringify(mgr.getRoom(code)!.gameState);
    expect(after).toBe(before);
  });
});

describe("RoomManager — rematch gate", () => {
  let mgr: RoomManager;
  beforeEach(() => (mgr = new RoomManager(silentEmitter())));

  it("rejects rematch during an active match", () => {
    const code = twoPlayerUnoRoom(mgr);
    expect(mgr.getRoom(code)!.phase).toBe("in_game");
    const res = mgr.rematch(code, "P_A");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("GAME_NOT_ACTIVE");
  });

  it("allows rematch only once the match is over, and reseeds a fresh deal", () => {
    const code = twoPlayerUnoRoom(mgr); // bestOf: 1 → one round decides the match
    const room = mgr.getRoom(code)!;
    const state = room.gameState as UnoState;

    // Force A to a single card and make it A's turn on a matching top card.
    const top = { id: "top", kind: "number" as const, color: "red" as const, value: 5 };
    state.discard = [top];
    state.activeColor = "red";
    state.turn = "A";
    state.hasDrawn = false;
    state.pendingDraw = 0;
    state.pendingDrawType = null;
    state.hands.A = [{ id: "winner", kind: "number", color: "red", value: 1 }];

    const win = mgr.action(code, "P_A", { type: "play_card", payload: { cardId: "winner" } });
    expect(win.ok).toBe(true);
    expect(room.phase).toBe("game_over");

    const epochBefore = room.matchEpoch;
    const res = mgr.rematch(code, "P_A");
    expect(res.ok).toBe(true);
    expect(room.matchEpoch).toBe(epochBefore + 1); // fresh seed → different deal
    expect(room.phase).toBe("in_game");
    const fresh = mgr.getSnapshot(code, "P_A")!.game!;
    expect(fresh.roundNumber).toBe(1);
  });

  it("rejects rematch from a non-member", () => {
    const code = twoPlayerUnoRoom(mgr);
    const res = mgr.rematch(code, "P_STRANGER");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_IN_ROOM");
  });
});
