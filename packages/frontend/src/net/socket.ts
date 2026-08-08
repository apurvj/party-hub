import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, HandshakeAuth, ServerToClientEvents } from "@party-hub/shared";
import { ErrorCode } from "@party-hub/shared";
import { getNickname, getPlayerId } from "./identity.js";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

let socket: AppSocket | null = null;

/**
 * Get (or lazily create) the shared socket, with the handshake `auth` carrying
 * the current identity (persistent playerId + nickname).
 *
 * IMPORTANT: this does NOT touch `auth.roomCode`. Room membership is owned
 * solely by `getRoomSocket` (called from the room lifecycle). If this cleared
 * the room code, then every action sender that calls `getSocket()` — submitting
 * a guess, next round, rematch — would bounce the connection into a room-less
 * handshake and the server would report "you're not in this room".
 *
 * The server reads auth ONCE at handshake time, so when the identity materially
 * changes on a live socket we bounce it to force a fresh handshake.
 */
export function getSocket(): AppSocket {
  const playerId = getPlayerId();
  const nickname = getNickname();
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      // Prefer a raw WebSocket (low latency), but fall back to HTTP long-polling
      // when a network blocks the WS upgrade — common on mobile/carrier/corporate
      // networks. `tryAllTransports` makes socket.io actually attempt the next
      // transport instead of giving up on the first failure. Safe here because we
      // run a SINGLE server instance (polling needs no sticky sessions).
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      auth: { playerId, nickname },
    });
    return socket;
  }
  const prev = socket.auth as Partial<HandshakeAuth>;
  const identityChanged = prev.playerId !== playerId || prev.nickname !== nickname;
  socket.auth = { ...prev, playerId, nickname };
  if (identityChanged && socket.connected) socket.disconnect().connect();
  return socket;
}

/**
 * Set the room the handshake should (re)join, WITHOUT connecting — the caller
 * attaches its event listeners first, then drives the connection, so it can't
 * miss a `connect` fired by a bounce. Returns whether the room actually changed
 * (so the caller knows to re-handshake a live socket). This is the ONLY writer
 * of `auth.roomCode`.
 */
export function setRoomCode(sock: AppSocket, roomCode?: string): boolean {
  const prev = sock.auth as Partial<HandshakeAuth>;
  const changed = prev.roomCode !== roomCode;
  sock.auth = { ...prev, roomCode };
  return changed;
}

/** How long we wait for a socket to finish its handshake before giving up. */
const CONNECT_TIMEOUT_MS = 8_000;
/** How long we wait for the server's ack after emitting, once connected. */
const ACK_TIMEOUT_MS = 10_000;

/**
 * Resolve once the socket is connected. Socket.io buffers `emit`s issued while
 * connecting and flushes them on connect — BUT only the *event* is buffered, not
 * an ack timeout, so an emit-with-ack fired before connect will hang forever if
 * the connection never lands. We gate every ack emit on this so a cold socket
 * (the very first click on a freshly-loaded page) can't spin indefinitely.
 */
function whenConnected(sock: AppSocket): Promise<void> {
  if (sock.connected) return Promise.resolve();
  if (!sock.active) sock.connect();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("connect_timeout"));
    }, CONNECT_TIMEOUT_MS);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      sock.off("connect", onConnect);
      sock.off("connect_error", onError);
    };
    sock.on("connect", onConnect);
    sock.on("connect_error", onError);
  });
}

/**
 * Promisified emit-with-ack.
 *
 * Two hard-won details:
 *  1. We wait for the socket to be connected before emitting. Emitting an
 *     ack event on a not-yet-connected socket means the ack callback never
 *     fires (Socket.io buffers the event but there's nothing to time out the
 *     ack), so callers like the Create/Join buttons would hang forever.
 *  2. We race the ack against a timeout so a dropped connection mid-flight
 *     surfaces as a failed `Result` (and the caller can re-enable its button)
 *     instead of a promise that never settles.
 *
 * When there's no request payload (e.g. `room:sync`, `room:rematch`), we must
 * NOT emit an explicit `undefined` arg: Socket.io would then deliver
 * `(undefined, callback)` and the server handler — typed `(ack) => …` — would
 * see `ack === undefined` and throw. Omitting the arg puts the ack callback in
 * the first position, matching the shared event contract.
 */
export async function emitAck<TReq, TRes>(
  sock: AppSocket,
  event: string,
  req?: TReq,
): Promise<TRes> {
  try {
    await whenConnected(sock);
  } catch {
    return networkError<TRes>("We couldn't reach the game server. Check your connection and try again.");
  }
  return new Promise<TRes>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(networkError<TRes>("The server didn't respond in time. Please try again."));
    }, ACK_TIMEOUT_MS);
    const cb = (res: TRes) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(res);
    };
    // NB: call `emit` ON the socket — extracting it into a bare variable and
    // calling that would invoke it with `this === undefined` (ES-module strict
    // mode), and socket.io's `emit` dereferences `this._opts`, throwing
    // synchronously. socket.io typing for dynamic event names is loose, so we
    // cast the socket at the boundary but keep the method call bound to it.
    const s = sock as unknown as { emit: (e: string, ...a: unknown[]) => void };
    try {
      if (req === undefined) s.emit(event, cb);
      else s.emit(event, req, cb);
    } catch {
      // A synchronous throw from emit must never leave the promise pending
      // (which would freeze the caller's button). Surface it as a clean failure.
      window.clearTimeout(timer);
      settled = true;
      resolve(networkError<TRes>("Something went wrong sending your request. Please try again."));
    }
  });
}

/**
 * A failed `Result` envelope for transport-level failures (no connection / no
 * ack). Shaped to match the server's `Result<T>` so callers can treat it
 * uniformly — they only ever read `.ok` and `.error.message`.
 */
function networkError<TRes>(message: string): TRes {
  return { ok: false, error: { code: ErrorCode.NETWORK, message } } as TRes;
}
