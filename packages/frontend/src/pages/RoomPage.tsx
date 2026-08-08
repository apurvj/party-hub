import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isValidRoomCode, normalizeRoomCode } from "@party-hub/shared";
import { AppShell } from "../components/AppShell.js";
import { ConnBar } from "../components/ConnBar.js";
import { Lobby } from "../components/Lobby.js";
import { Button, Card, Input } from "../design-system/index.js";
import { WordleGame } from "../games/wordle/WordleGame.js";
import { getNickname, setNickname } from "../net/identity.js";
import { useRoom } from "../net/useRoom.js";

export function RoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const code = normalizeRoomCode(rawCode ?? "");
  const valid = isValidRoomCode(code);

  // Gate: a player must have a nickname BEFORE we connect. Someone opening a
  // shared link has never passed through Home, so without this they'd be
  // auto-joined on the handshake as the default "Player". We hold the code back
  // from useRoom (pass `undefined`) until they've named themselves — that keeps
  // the socket from auto-joining, then the identity change re-handshakes cleanly.
  const [nickname, setNick] = useState(() => getNickname());
  const hasNickname = nickname.trim().length > 0;

  const { status, room, lastEvent, joinRoom, submitGuess, nextRound, requestHint, rematch } = useRoom(
    valid && hasNickname ? code : undefined,
  );

  // Joining is driven by the socket handshake: `useRoom(code)` connects with the
  // room code in auth, and the server auto-joins/reconnects us and pushes
  // `room:state`. That covers deep-links, client-side nav, and reconnects with a
  // single mechanism (no eager duplicate room:join).
  //
  // The one gap the handshake leaves is a *silent* failure (e.g. room full/not
  // found → the server emits a fire-and-forget error, room stays null). So as a
  // fallback ONLY, if the room hasn't materialised shortly after we're
  // connected, we send an explicit room:join to get a definitive ack and either
  // recover or surface the reason. Reset per-code so navigating between rooms
  // re-arms it.
  const [joinError, setJoinError] = useState<string | null>(null);
  useEffect(() => setJoinError(null), [code]);
  useEffect(() => {
    // Don't attempt a fallback join until we actually have a nickname — before
    // that useRoom holds the code back, so the socket is connected but room-less
    // and a join would be rejected with NICKNAME_REQUIRED.
    if (!valid || !hasNickname || room || status !== "connected") return;
    const t = window.setTimeout(() => {
      void joinRoom(code).then((res) => {
        if (!res.ok) setJoinError(res.error.message);
      });
    }, 2000);
    return () => window.clearTimeout(t);
  }, [valid, hasNickname, status, code, room, joinRoom]);

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${code}` : "";

  if (!valid) {
    return (
      <AppShell>
        <CenteredCard
          title="That room code looks off"
          body="Double-check the link, or start a fresh room."
          onHome={() => navigate("/")}
        />
      </AppShell>
    );
  }

  if (joinError) {
    return (
      <AppShell>
        <CenteredCard title="Couldn't join this room" body={joinError} onHome={() => navigate("/")} />
      </AppShell>
    );
  }

  // No nickname yet (opened via shared link) → ask for one before joining.
  if (!hasNickname) {
    return (
      <AppShell>
        <NicknameGate
          code={code}
          onSubmit={(name) => {
            setNickname(name); // persist so the handshake picks it up
            setNick(name); // unblocks useRoom(code) → connects & auto-joins
          }}
        />
      </AppShell>
    );
  }

  return (
    <>
      <ConnBar status={status} />
      <AppShell>
        {!room || room.phase === "waiting" ? (
          room ? (
            <Lobby room={room} shareUrl={shareUrl} />
          ) : (
            <Connecting nickname={nickname} />
          )
        ) : room.game && room.game.gameId === "wordle" ? (
          <WordleGame
            room={room}
            game={room.game}
            lastEvent={lastEvent}
            onGuess={submitGuess}
            onNextRound={nextRound}
            onHint={requestHint}
            onRematch={rematch}
          />
        ) : (
          <Connecting nickname={nickname} />
        )}
      </AppShell>
    </>
  );
}

/**
 * Shown when someone opens a shared room link without a saved nickname. They
 * name themselves here BEFORE we connect, so the server seats them under their
 * real name instead of the default "Player".
 */
function NicknameGate({ code, onSubmit }: { code: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  const name = value.trim();

  const submit = () => {
    if (name) onSubmit(name);
  };

  return (
    <div className="mx-auto max-w-md pt-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
      >
        <Card className="space-y-5 text-center">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">You're invited to play</h2>
            <p className="mt-2 text-ink-soft">
              Joining room <span className="font-display font-bold tracking-wide text-brand">{code}</span>.
              Pick a nickname so your friend knows who's who.
            </p>
          </div>
          <Input
            label="Your nickname"
            placeholder="e.g. Sam"
            value={value}
            maxLength={16}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button fullWidth size="lg" disabled={!name} onClick={submit}>
            Join the room →
          </Button>
        </Card>
      </motion.div>
    </div>
  );
}

function Connecting({ nickname }: { nickname: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <div className="relative mx-auto mb-6 h-12 w-12">
        <div className="absolute inset-0 rounded-full bg-brand/25 blur-lg" aria-hidden />
        <motion.div
          className="relative h-12 w-12 rounded-full border-4 border-border border-t-brand shadow-e2"
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
          role="status"
          aria-label="Connecting"
        />
      </div>
      <p className="text-ink-soft">
        {nickname ? `Getting your room ready, ${nickname}…` : "Getting your room ready…"}
      </p>
    </div>
  );
}

function CenteredCard({
  title,
  body,
  onHome,
}: {
  title: string;
  body: string;
  onHome: () => void;
}) {
  return (
    <div className="mx-auto max-w-md pt-16">
      <Card className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
        <p className="mt-2 text-ink-soft">{body}</p>
        <div className="mt-6">
          <Button fullWidth onClick={onHome}>
            Back to home
          </Button>
        </div>
      </Card>
    </div>
  );
}
