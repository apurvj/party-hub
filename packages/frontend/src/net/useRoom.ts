import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateRoomReq,
  CreateRoomRes,
  DiceOutcome,
  GameEvent,
  MatchDareOutcome,
  MatchVote,
  QuestionSection,
  Result,
  RoomNotice,
  RoomStatePayload,
  Sex,
  UnoColor,
  WordleConfig,
} from "@party-hub/shared";
import { useToast } from "../design-system/index.js";
import { getNickname, setNickname as persistNickname } from "./identity.js";
import { emitAck, getSocket, setRoomCode } from "./socket.js";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

/**
 * Structural guard for an incoming room snapshot. The server is trusted, but a
 * stale relay, a version skew, or a bug shouldn't be able to feed React a
 * half-shaped object that then crashes deep in a render. We check the fields the
 * UI dereferences unconditionally; the game view is validated by its own
 * discriminant (`gameId`) where it's read.
 */
function isRoomStatePayload(x: unknown): x is RoomStatePayload {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.code === "string" &&
    typeof r.phase === "string" &&
    typeof r.you === "object" &&
    r.you !== null &&
    Array.isArray(r.players) &&
    typeof r.config === "object" &&
    r.config !== null
  );
}

interface UseRoomResult {
  status: ConnStatus;
  room: RoomStatePayload | null;
  /** Latest transient game event (round_over, etc.) with a monotonic id. */
  lastEvent: { seq: number; event: GameEvent } | null;
  createRoom: (wordle: Partial<WordleConfig>) => Promise<Result<CreateRoomRes>>;
  joinRoom: (code: string) => Promise<Result<RoomStatePayload>>;
  submitGuess: (guess: string) => Promise<Result<null>>;
  nextRound: () => Promise<Result<null>>;
  requestHint: () => Promise<Result<null>>;
  rematch: () => Promise<Result<null>>;
  /** Uno action senders (no-ops for other games). */
  unoPlay: (cardId: string, chosenColor?: UnoColor) => Promise<Result<null>>;
  unoDraw: () => Promise<Result<null>>;
  unoPass: () => Promise<Result<null>>;
  unoCallUno: () => Promise<Result<null>>;
  unoCatch: () => Promise<Result<null>>;
  /** Guess the Person action senders. */
  gwChoose: (personId: string) => Promise<Result<null>>;
  gwAsk: (section: QuestionSection, value: string) => Promise<Result<null>>;
  gwGuess: (personId: string) => Promise<Result<null>>;
  gwPass: () => Promise<Result<null>>;
  /** Match action senders. */
  matchSetSex: (sex: Sex) => Promise<Result<null>>;
  matchVote: (cardId: string, vote: MatchVote) => Promise<Result<null>>;
  matchDareAdvance: (outcome: MatchDareOutcome) => Promise<Result<null>>;
  matchSafeword: () => Promise<Result<null>>;
  /** Dice (Dare Roulette) action senders. */
  diceSetSex: (sex: Sex) => Promise<Result<null>>;
  diceSpin: () => Promise<Result<null>>;
  diceResolve: (outcome: DiceOutcome) => Promise<Result<null>>;
  diceSafeword: () => Promise<Result<null>>;
}

/**
 * Central client networking hook. Owns the socket lifecycle, keeps the
 * authoritative room snapshot in state, surfaces connection status, and exposes
 * action senders. When `roomCode` is provided (deep link), it connects with
 * that code so the server auto-joins/reconnects on the handshake.
 */
export function useRoom(roomCode?: string): UseRoomResult {
  const { show } = useToast();
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [room, setRoom] = useState<RoomStatePayload | null>(null);
  const [lastEvent, setLastEvent] = useState<{ seq: number; event: GameEvent } | null>(null);
  const seqRef = useRef(0);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    const sock = getSocket();
    // Point the handshake at this room (the only writer of auth.roomCode).
    const roomChanged = setRoomCode(sock, roomCode);

    const applyState = (state: RoomStatePayload) => {
      if (isRoomStatePayload(state)) setRoom(state);
      else show("Received an unexpected update from the server.", "danger");
    };

    const onConnect = () => {
      setStatus("connected");
      // If we already had a room (e.g. after a socket drop), resync.
      if (roomCode) {
        void emitAck<undefined, Result<RoomStatePayload>>(sock, "room:sync").then((res) => {
          if (res.ok) applyState(res.data);
          else show(res.error.message, "danger");
        });
      }
    };
    const onDisconnect = () => setStatus("disconnected");
    const onReconnectAttempt = () => setStatus("reconnecting");
    const onState = (state: RoomStatePayload) => applyState(state);
    const onNotice = (notice: RoomNotice) => {
      const kind =
        notice.kind === "opponent_disconnected"
          ? "warning"
          : notice.kind === "opponent_left"
            ? "danger"
            : "success";
      show(notice.message, kind);
    };
    const onEvent = (event: GameEvent) => setLastEvent({ seq: ++seqRef.current, event });
    const onError = (err: { message: string }) => show(err.message, "danger");

    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);
    sock.io.on("reconnect_attempt", onReconnectAttempt);
    sock.on("room:state", onState);
    sock.on("room:notice", onNotice);
    sock.on("game:event", onEvent);
    sock.on("error", onError);

    // Handlers are attached above, so a bounce here can't miss `connect`.
    if (!sock.connected) {
      setStatus("connecting");
      sock.connect();
    } else if (roomChanged) {
      // Live socket but the room changed (client-side nav between rooms): force
      // a fresh handshake so the server re-runs auto-join for the new room.
      setStatus("connecting");
      sock.disconnect().connect();
    } else {
      onConnect();
    }

    // Heartbeat keeps presence fresh and detects half-open sockets.
    heartbeatRef.current = window.setInterval(() => {
      if (sock.connected) sock.emit("ping", () => {});
    }, 25_000);

    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      sock.io.off("reconnect_attempt", onReconnectAttempt);
      sock.off("room:state", onState);
      sock.off("room:notice", onNotice);
      sock.off("game:event", onEvent);
      sock.off("error", onError);
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    };
  }, [roomCode, show]);

  const createRoom = useCallback(async (wordle: Partial<WordleConfig>) => {
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    const req: CreateRoomReq = { gameId: "wordle", wordle };
    return emitAck<CreateRoomReq, Result<CreateRoomRes>>(sock, "room:create", req);
  }, []);

  const joinRoom = useCallback(async (code: string) => {
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    const res = await emitAck<{ code: string }, Result<RoomStatePayload>>(sock, "room:join", { code });
    if (res.ok) setRoom(res.data);
    return res;
  }, []);

  const submitGuess = useCallback(async (guess: string) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { guess: string } }, Result<null>>(sock, "game:action", {
      type: "submit_guess",
      payload: { guess },
    });
  }, []);

  const nextRound = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "next_round" });
  }, []);

  const requestHint = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "hint" });
  }, []);

  const rematch = useCallback(async () => {
    const sock = getSocket();
    return emitAck<undefined, Result<null>>(sock, "room:rematch");
  }, []);

  const unoPlay = useCallback(async (cardId: string, chosenColor?: UnoColor) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { cardId: string; chosenColor?: UnoColor } }, Result<null>>(
      sock,
      "game:action",
      { type: "play_card", payload: { cardId, chosenColor } },
    );
  }, []);

  const unoDraw = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "draw_card" });
  }, []);

  const unoPass = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "pass" });
  }, []);

  const unoCallUno = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "call_uno" });
  }, []);

  const unoCatch = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "catch_uno" });
  }, []);

  const gwChoose = useCallback(async (personId: string) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { personId: string } }, Result<null>>(sock, "game:action", {
      type: "choose",
      payload: { personId },
    });
  }, []);

  const gwAsk = useCallback(async (section: QuestionSection, value: string) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { section: QuestionSection; value: string } }, Result<null>>(
      sock,
      "game:action",
      { type: "ask", payload: { section, value } },
    );
  }, []);

  const gwGuess = useCallback(async (personId: string) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { personId: string } }, Result<null>>(sock, "game:action", {
      type: "guess",
      payload: { personId },
    });
  }, []);

  const gwPass = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "pass" });
  }, []);

  const matchSetSex = useCallback(async (sex: Sex) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { sex: Sex } }, Result<null>>(sock, "game:action", {
      type: "set_sex",
      payload: { sex },
    });
  }, []);

  const matchVote = useCallback(async (cardId: string, vote: MatchVote) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { cardId: string; vote: MatchVote } }, Result<null>>(
      sock,
      "game:action",
      { type: "vote", payload: { cardId, vote } },
    );
  }, []);

  const matchDareAdvance = useCallback(async (outcome: MatchDareOutcome) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { outcome: MatchDareOutcome } }, Result<null>>(
      sock,
      "game:action",
      { type: "dare_advance", payload: { outcome } },
    );
  }, []);

  const matchSafeword = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "safeword" });
  }, []);

  const diceSetSex = useCallback(async (sex: Sex) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { sex: Sex } }, Result<null>>(sock, "game:action", {
      type: "set_sex",
      payload: { sex },
    });
  }, []);

  const diceSpin = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "spin" });
  }, []);

  const diceResolve = useCallback(async (outcome: DiceOutcome) => {
    const sock = getSocket();
    return emitAck<{ type: string; payload: { outcome: DiceOutcome } }, Result<null>>(
      sock,
      "game:action",
      { type: "resolve", payload: { outcome } },
    );
  }, []);

  const diceSafeword = useCallback(async () => {
    const sock = getSocket();
    return emitAck<{ type: string }, Result<null>>(sock, "game:action", { type: "safeword" });
  }, []);

  return {
    status,
    room,
    lastEvent,
    createRoom,
    joinRoom,
    submitGuess,
    nextRound,
    requestHint,
    rematch,
    unoPlay,
    unoDraw,
    unoPass,
    unoCallUno,
    unoCatch,
    gwChoose,
    gwAsk,
    gwGuess,
    gwPass,
    matchSetSex,
    matchVote,
    matchDareAdvance,
    matchSafeword,
    diceSetSex,
    diceSpin,
    diceResolve,
    diceSafeword,
  };
}

export { getNickname, persistNickname };
