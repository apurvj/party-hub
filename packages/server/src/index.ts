import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import {
  DEFAULT_WORDLE_CONFIG,
  ErrorCode,
  fail,
  isValidRoomCode,
  makeError,
  normalizeRoomCode,
  ok,
  type ClientToServerEvents,
  type GameEvent,
  type HandshakeAuth,
  type RoomNoticeKind,
  type RoomStatePayload,
  type ServerToClientEvents,
} from "@party-hub/shared";
import { config } from "./config.js";
import { ENABLED_GAMES } from "./registry.js";
import { RateLimiter } from "./rateLimit.js";
import { RoomManager } from "./rooms.js";
import { logWordlistIntegrity } from "./games/wordle/wordlist.js";

/** Pick the last function argument (the Socket.io ack callback), if any. */
function lastFn(args: unknown[]): ((...a: unknown[]) => void) | undefined {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === "function") return args[i] as (...a: unknown[]) => void;
  }
  return undefined;
}

// ---- validation schemas ----------------------------------------------------

const wordleConfigSchema = z
  .object({
    mode: z.enum(["race", "coop"]).optional(),
    difficulty: z.enum(["easy", "normal", "hard"]).optional(),
    bestOf: z.number().int().min(1).max(9).optional(),
  })
  .optional();

const createRoomSchema = z.object({
  gameId: z.enum(["wordle"]),
  wordle: wordleConfigSchema,
});

const joinRoomSchema = z.object({ code: z.string().min(1).max(12) });
const gameActionSchema = z.object({ type: z.string().min(1).max(40), payload: z.unknown().optional() });

// ---- app + io ---------------------------------------------------------------

const app = express();
app.use(cors({ origin: config.clientOrigins, credentials: true }));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.roomCount }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: config.clientOrigins, credentials: true },
});

// The room engine emits to players by playerId. A single identity can hold more
// than one live socket at once (e.g. the room opened in two browser tabs — they
// share a localStorage playerId), so we track a SET of socket ids per player and
// fan out to every one. This avoids the "last socket wins" bug (a second tab
// silently orphaning the first) without kicking sockets and triggering a
// reconnect war between two live tabs.
const playerSockets = new Map<string, Set<string>>();

function addPlayerSocket(playerId: string, socketId: string): void {
  const set = playerSockets.get(playerId);
  if (set) set.add(socketId);
  else playerSockets.set(playerId, new Set([socketId]));
}

function removePlayerSocket(playerId: string, socketId: string): void {
  const set = playerSockets.get(playerId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) playerSockets.delete(playerId);
}

function emitTo<K extends keyof ServerToClientEvents>(
  playerId: string,
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
): void {
  const set = playerSockets.get(playerId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit(event, ...args);
}

const rooms = new RoomManager({
  emitRoomState: (playerId, state: RoomStatePayload) => emitTo(playerId, "room:state", state),
  emitGameEvent: (playerId, ev: GameEvent) => emitTo(playerId, "game:event", ev),
  emitNotice: (playerId, notice: { kind: RoomNoticeKind; message: string }) =>
    emitTo(playerId, "room:notice", notice),
});

// ---- rate limiters ----------------------------------------------------------

const guessLimiter = new RateLimiter(config.maxGuessesPerSec, 1_000);
// A looser cap on ALL game actions (valid or not) so an attacker can't spam
// non-guess / invalid action types to burn CPU under the guess limit's radar.
const actionLimiter = new RateLimiter(config.maxActionsPerSec, 1_000);
const createLimiter = new RateLimiter(config.maxRoomCreatesPerMin, 60_000);
const joinLimiter = new RateLimiter(config.maxJoinsPerMin, 60_000);

// Periodically evict idle keys from every limiter so the maps don't grow
// unbounded as players churn. `.unref()` so this timer never keeps the process
// alive on its own.
setInterval(() => {
  for (const l of [guessLimiter, actionLimiter, createLimiter, joinLimiter]) l.sweep();
}, config.cleanupIntervalMs).unref?.();

// ---- socket wiring ----------------------------------------------------------

io.on("connection", (socket) => {
  const auth = socket.handshake.auth as Partial<HandshakeAuth>;
  // Trim so a whitespace-only id (" ") can't masquerade as a real, distinct
  // player — an empty/blank id is never a valid identity.
  const playerId = typeof auth.playerId === "string" ? auth.playerId.trim() : "";
  const nickname = typeof auth.nickname === "string" ? auth.nickname : "";

  if (!playerId) {
    socket.emit("error", makeError(ErrorCode.INTERNAL, "Missing player id."));
    socket.disconnect(true);
    return;
  }

  addPlayerSocket(playerId, socket.id);
  // Track which room this socket is currently in (for disconnect handling).
  let currentRoom: string | null = null;

  // Auto-join when landing directly on /room/:code (shared link).
  if (auth.roomCode && isValidRoomCode(normalizeRoomCode(auth.roomCode))) {
    const code = normalizeRoomCode(auth.roomCode);
    // A brand-new player MUST name themselves first (mirrors the room:create /
    // room:join handlers). Without this, a shared-link visitor would be seated
    // as the default "Player". A reconnect (already-seated playerId) is exempt —
    // their nickname is already on file, so we let them back in even if the
    // handshake nickname is momentarily blank.
    const isReconnect = rooms.hasPlayer(code, playerId);
    if (!isReconnect && !nickname.trim()) {
      socket.emit("error", makeError(ErrorCode.NICKNAME_REQUIRED));
    } else {
      const res = rooms.join(code, playerId, nickname);
      if (res.ok) {
        currentRoom = code;
        socket.join(code);
        socket.emit("room:state", res.state);
      } else {
        socket.emit("error", res.error);
      }
    }
  }

  socket.on("room:create", (req, ack) => {
    const parsed = createRoomSchema.safeParse(req);
    if (!parsed.success) return ack(fail(makeError(ErrorCode.INVALID_ACTION)));
    if (!ENABLED_GAMES.includes(parsed.data.gameId)) return ack(fail(makeError(ErrorCode.UNKNOWN_GAME)));
    if (!createLimiter.take(playerId)) return ack(fail(makeError(ErrorCode.RATE_LIMITED)));
    if (!nickname.trim()) return ack(fail(makeError(ErrorCode.NICKNAME_REQUIRED)));

    const room = rooms.createRoom(parsed.data.gameId, {
      wordle: { ...DEFAULT_WORDLE_CONFIG, ...parsed.data.wordle },
    });
    const res = rooms.join(room.code, playerId, nickname);
    if (!res.ok) return ack(fail(res.error));
    currentRoom = room.code;
    socket.join(room.code);
    ack(ok({ code: room.code }));
  });

  socket.on("room:join", (req, ack) => {
    const parsed = joinRoomSchema.safeParse(req);
    if (!parsed.success) return ack(fail(makeError(ErrorCode.INVALID_ROOM_CODE)));
    const code = normalizeRoomCode(parsed.data.code);
    if (!isValidRoomCode(code)) return ack(fail(makeError(ErrorCode.INVALID_ROOM_CODE)));
    if (!joinLimiter.take(playerId)) return ack(fail(makeError(ErrorCode.RATE_LIMITED)));
    if (!nickname.trim()) return ack(fail(makeError(ErrorCode.NICKNAME_REQUIRED)));

    const res = rooms.join(code, playerId, nickname);
    if (!res.ok) return ack(fail(res.error));
    currentRoom = code;
    socket.join(code);
    ack(ok(res.state));
  });

  // No-payload events: the ack is the callback the client passed. Some clients
  // may deliver a stray leading arg, so pick the LAST function argument as the
  // ack rather than assuming a fixed position — and never trust it's present.
  socket.on("room:sync", (...args: unknown[]) => {
    const ack = lastFn(args);
    if (!ack) return;
    if (!currentRoom) return ack(fail(makeError(ErrorCode.NOT_IN_ROOM)));
    const snap = rooms.getSnapshot(currentRoom, playerId);
    if (!snap) return ack(fail(makeError(ErrorCode.NOT_IN_ROOM)));
    ack(ok(snap));
  });

  socket.on("game:action", (req, ack) => {
    if (!currentRoom) return ack(fail(makeError(ErrorCode.NOT_IN_ROOM)));
    // Rate-limit EVERY action (before schema parsing) so malformed/unknown
    // action spam is throttled too, not just valid guesses.
    if (!actionLimiter.take(playerId)) return ack(fail(makeError(ErrorCode.RATE_LIMITED)));
    const parsed = gameActionSchema.safeParse(req);
    if (!parsed.success) return ack(fail(makeError(ErrorCode.INVALID_ACTION)));
    if (parsed.data.type === "submit_guess" && !guessLimiter.take(playerId)) {
      return ack(fail(makeError(ErrorCode.RATE_LIMITED)));
    }
    const res = rooms.action(currentRoom, playerId, parsed.data);
    if (!res.ok) return ack(fail(res.error));
    ack(ok(null));
  });

  socket.on("room:rematch", (...args: unknown[]) => {
    const ack = lastFn(args);
    if (!ack) return;
    if (!currentRoom) return ack(fail(makeError(ErrorCode.NOT_IN_ROOM)));
    const res = rooms.rematch(currentRoom, playerId);
    if (!res.ok) return ack(fail(res.error));
    ack(ok(null));
  });

  socket.on("ping", (...args: unknown[]) => {
    const ack = lastFn(args);
    if (!ack) return;
    if (currentRoom) rooms.heartbeat(currentRoom, playerId);
    ack(Date.now());
  });

  socket.on("disconnect", () => {
    removePlayerSocket(playerId, socket.id);
    // Only start the grace timer once this player has NO live sockets left; if
    // another tab is still connected the player hasn't actually left.
    if (currentRoom && !playerSockets.has(playerId)) rooms.handleDisconnect(currentRoom, playerId);
  });
});

// ---- resilience -------------------------------------------------------------

// A single bad socket message must never take down the whole process (and with
// it every active room). Log and keep serving other rooms.
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[party-hub] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[party-hub] unhandledRejection:", reason);
});

// ---- boot -------------------------------------------------------------------

logWordlistIntegrity();
httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[party-hub] server listening on :${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[party-hub] allowed origins: ${config.clientOrigins.join(", ")}`);
});
