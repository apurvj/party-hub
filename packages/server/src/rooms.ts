import {
  ErrorCode,
  makeError,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type GameContext,
  type GameEvent,
  type GameId,
  type PlayerView,
  type RoomConfig,
  type RoomPhase,
  type RoomStatePayload,
  type Seat,
  type AppError,
} from "@party-hub/shared";
import { config } from "./config.js";
import { createGameModule, type AnyGameModule, type GameConfigs } from "./registry.js";

interface Player {
  playerId: string;
  nickname: string;
  seat: Seat | null;
  connected: boolean;
  lastSeen: number;
  /** Timer that frees the seat if they don't reconnect within the grace window. */
  graceTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  gameId: GameId;
  configs: GameConfigs;
  phase: RoomPhase;
  players: Map<string, Player>; // by playerId
  seats: Record<Seat, string | null>;
  module: AnyGameModule;
  gameState: unknown;
  createdAt: number;
  lastActivity: number;
}

/** Injected so the engine can push state to sockets without importing io. */
export interface RoomEmitter {
  emitRoomState: (playerId: string, state: RoomStatePayload) => void;
  emitGameEvent: (playerId: string, event: GameEvent) => void;
  emitNotice: (playerId: string, notice: ReturnType<typeof makeNotice>) => void;
}

function makeNotice(
  kind: "opponent_joined" | "opponent_left" | "opponent_disconnected" | "opponent_reconnected",
) {
  const messages: Record<typeof kind, string> = {
    opponent_joined: "Your opponent joined!",
    opponent_left: "Your opponent left the room.",
    opponent_disconnected: "Opponent disconnected — waiting for them to return…",
    opponent_reconnected: "Opponent is back!",
  };
  return { kind, message: messages[kind] };
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private emitter: RoomEmitter;

  constructor(emitter: RoomEmitter) {
    this.emitter = emitter;
    setInterval(() => this.sweep(), config.cleanupIntervalMs).unref?.();
  }

  // ---- helpers ------------------------------------------------------------

  private genCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Failed to generate a unique room code");
  }

  private ctxFor(room: Room): GameContext {
    return {
      code: room.code,
      seatOf: (pid) => room.players.get(pid)?.seat ?? null,
      playerIdOf: (seat) => room.seats[seat],
    };
  }

  private touch(room: Room): void {
    room.lastActivity = Date.now();
  }

  private countSeatedPlayers(room: Room): number {
    return (room.seats.A ? 1 : 0) + (room.seats.B ? 1 : 0);
  }

  private assignSeat(room: Room, player: Player): Seat | null {
    if (player.seat) return player.seat;
    if (!room.seats.A) {
      room.seats.A = player.playerId;
      player.seat = "A";
    } else if (!room.seats.B) {
      room.seats.B = player.playerId;
      player.seat = "B";
    }
    return player.seat;
  }

  /**
   * The room roster — identical for every recipient except the `isYou` flag,
   * which we stamp per-viewer in `snapshotFor`. Built once per broadcast.
   */
  private rosterOf(room: Room): Omit<PlayerView, "isYou">[] {
    const list: Omit<PlayerView, "isYou">[] = [];
    for (const p of room.players.values()) {
      if (p.seat === null) continue;
      list.push({ playerId: p.playerId, nickname: p.nickname, seat: p.seat, connected: p.connected });
    }
    return list;
  }

  private snapshotFor(
    room: Room,
    playerId: string,
    roster: Omit<PlayerView, "isYou">[] = this.rosterOf(room),
  ): RoomStatePayload {
    const me = room.players.get(playerId)!;
    const gameView =
      room.gameState != null
        ? room.module.sanitizeFor(room.gameState, playerId, this.ctxFor(room))
        : null;
    return {
      code: room.code,
      gameId: room.gameId,
      phase: room.phase,
      you: {
        playerId: me.playerId,
        nickname: me.nickname,
        seat: me.seat,
        connected: me.connected,
        isYou: true,
      },
      players: roster.map((p) => ({ ...p, isYou: p.playerId === playerId })),
      yourSeat: me.seat,
      config: this.roomConfig(room),
      game: gameView as RoomStatePayload["game"],
    };
  }

  private roomConfig(room: Room): RoomConfig {
    return { wordle: room.configs.wordle };
  }

  /** Push fresh state to every connected, seated player. */
  private broadcastState(room: Room): void {
    const roster = this.rosterOf(room); // identical for all recipients — build once
    for (const p of room.players.values()) {
      if (p.connected) this.emitter.emitRoomState(p.playerId, this.snapshotFor(room, p.playerId, roster));
    }
  }

  private broadcastEvent(room: Room, events: GameEvent[]): void {
    for (const p of room.players.values()) {
      if (!p.connected) continue;
      for (const e of events) this.emitter.emitGameEvent(p.playerId, e);
    }
  }

  private opponentOf(room: Room, playerId: string): Player | null {
    for (const p of room.players.values()) if (p.playerId !== playerId && p.seat) return p;
    return null;
  }

  private noticeOpponent(room: Room, playerId: string, kind: Parameters<typeof makeNotice>[0]): void {
    const opp = this.opponentOf(room, playerId);
    if (opp?.connected) this.emitter.emitNotice(opp.playerId, makeNotice(kind));
  }

  private maybeStartGame(room: Room): void {
    const seated = this.countSeatedPlayers(room);
    if (seated === 2 && room.gameState == null) {
      room.gameState = room.module.createInitialState(this.ctxFor(room));
      room.phase = room.module.phaseOf(room.gameState);
    } else if (seated === 2 && (room.phase === "waiting" || room.phase === "ready")) {
      room.phase = room.module.phaseOf(room.gameState);
    }
  }

  // ---- public API ---------------------------------------------------------

  createRoom(gameId: GameId, configs: GameConfigs): Room {
    const code = this.genCode();
    const room: Room = {
      code,
      gameId,
      configs,
      phase: "waiting",
      players: new Map(),
      seats: { A: null, B: null },
      module: createGameModule(gameId, configs),
      gameState: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Whether this player already holds a seat in the room (i.e. a reconnect). */
  hasPlayer(code: string, playerId: string): boolean {
    return this.rooms.get(code)?.players.has(playerId) ?? false;
  }

  /**
   * Join or reconnect. Idempotent per playerId: an existing player (same
   * playerId) reclaims their seat and gets a full state replay. Returns the
   * snapshot for the joining player, or an error.
   */
  join(
    code: string,
    playerId: string,
    nickname: string,
  ): { ok: true; room: Room; state: RoomStatePayload; reconnected: boolean } | { ok: false; error: AppError } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: makeError(ErrorCode.ROOM_NOT_FOUND) };

    const existing = room.players.get(playerId);
    if (existing) {
      // Reconnect: cancel grace timer, mark connected, refresh nickname.
      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      const wasDisconnected = !existing.connected;
      existing.connected = true;
      existing.lastSeen = Date.now();
      if (nickname.trim()) existing.nickname = nickname.trim();
      this.touch(room);
      if (wasDisconnected) this.noticeOpponent(room, playerId, "opponent_reconnected");
      this.broadcastState(room);
      return { ok: true, room, state: this.snapshotFor(room, playerId), reconnected: true };
    }

    // New player: need a free seat.
    if (this.countSeatedPlayers(room) >= 2) return { ok: false, error: makeError(ErrorCode.ROOM_FULL) };

    const player: Player = {
      playerId,
      nickname: nickname.trim() || "Player",
      seat: null,
      connected: true,
      lastSeen: Date.now(),
      graceTimer: null,
    };
    room.players.set(playerId, player);
    this.assignSeat(room, player);
    this.maybeStartGame(room);
    this.touch(room);

    this.noticeOpponent(room, playerId, "opponent_joined");
    this.broadcastState(room);
    return { ok: true, room, state: this.snapshotFor(room, playerId), reconnected: false };
  }

  /** Handle a game action from a player. */
  action(
    code: string,
    playerId: string,
    rawAction: unknown,
  ): { ok: true } | { ok: false; error: AppError } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: makeError(ErrorCode.ROOM_NOT_FOUND) };
    if (!room.players.get(playerId)?.seat) return { ok: false, error: makeError(ErrorCode.NOT_IN_ROOM) };
    if (room.gameState == null) return { ok: false, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
    if (!room.module.isValidAction(rawAction)) {
      return { ok: false, error: makeError(ErrorCode.INVALID_ACTION) };
    }

    const result = room.module.reduce(room.gameState, rawAction, playerId, this.ctxFor(room));
    room.gameState = result.state;
    if (result.nextPhase) room.phase = result.nextPhase;
    this.touch(room);

    if (result.error) {
      // Broadcast the (unchanged) state anyway is unnecessary; just report error.
      return { ok: false, error: result.error };
    }

    this.broadcastState(room);
    if (result.events?.length) this.broadcastEvent(room, result.events);
    return { ok: true };
  }

  /** Rematch: reset the game to a fresh match (round 1), keeping seats/scores 0. */
  rematch(code: string, playerId: string): { ok: true } | { ok: false; error: AppError } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: makeError(ErrorCode.ROOM_NOT_FOUND) };
    if (!room.players.get(playerId)?.seat) return { ok: false, error: makeError(ErrorCode.NOT_IN_ROOM) };
    room.gameState = room.module.createInitialState(this.ctxFor(room));
    room.phase = room.module.phaseOf(room.gameState);
    this.touch(room);
    this.broadcastState(room);
    this.broadcastEvent(room, [{ kind: "round_started", roundNumber: 1 }]);
    return { ok: true };
  }

  getSnapshot(code: string, playerId: string): RoomStatePayload | null {
    const room = this.rooms.get(code);
    if (!room || !room.players.has(playerId)) return null;
    return this.snapshotFor(room, playerId);
  }

  /** A socket disconnected. Start the grace timer; free the seat if it lapses. */
  handleDisconnect(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    player.connected = false;
    player.lastSeen = Date.now();
    this.touch(room);
    this.noticeOpponent(room, playerId, "opponent_disconnected");
    this.broadcastState(room);

    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = setTimeout(() => {
      const r = this.rooms.get(code);
      if (!r) return;
      const p = r.players.get(playerId);
      if (!p || p.connected) return;
      // Free the seat.
      if (p.seat) r.seats[p.seat] = null;
      r.players.delete(playerId);
      this.noticeOpponent(r, playerId, "opponent_left");
      this.broadcastState(r);
      if (r.players.size === 0) this.rooms.delete(code);
    }, config.seatGraceMs);
    player.graceTimer.unref?.();
  }

  heartbeat(code: string, playerId: string): void {
    const p = this.rooms.get(code)?.players.get(playerId);
    if (p) p.lastSeen = Date.now();
  }

  /** Periodic GC of idle rooms. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > config.roomTtlMs) {
        for (const p of room.players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
        this.rooms.delete(code);
      }
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}
