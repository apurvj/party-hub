import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WordleMode } from "@party-hub/shared";
import { isValidRoomCode, normalizeRoomCode } from "@party-hub/shared";
import { AppShell } from "../components/AppShell.js";
import { Button, Card, Input, cx, useToast } from "../design-system/index.js";
import { getNickname, setNickname } from "../net/identity.js";
import { getSocket, emitAck } from "../net/socket.js";
import type { CreateRoomReq, CreateRoomRes, Result } from "@party-hub/shared";

const MODES: { value: WordleMode; label: string; blurb: string; icon: string }[] = [
  { value: "race", label: "Race", blurb: "Same word, first to solve wins", icon: "⚡️" },
  { value: "coop", label: "Co-op", blurb: "Solve one board together, take turns", icon: "🤝" },
];

const BEST_OF = [1, 3, 5];

export function HomePage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [nickname, setNick] = useState(getNickname());
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<WordleMode>("race");
  const [bestOf, setBestOf] = useState(3);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const nick = nickname.trim();

  async function handleCreate() {
    if (!nick) return show("Pick a nickname first!", "warning");
    setNickname(nick);
    setBusy("create");
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    const req: CreateRoomReq = { gameId: "wordle", wordle: { mode, bestOf, difficulty: "normal" } };
    const res = await emitAck<CreateRoomReq, Result<CreateRoomRes>>(sock, "room:create", req);
    setBusy(null);
    if (res.ok) navigate(`/room/${res.data.code}`);
    else show(res.error.message, "danger");
  }

  async function handleJoin() {
    if (!nick) return show("Pick a nickname first!", "warning");
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) return show("That room code doesn't look right.", "warning");
    setNickname(nick);
    setBusy("join");
    // Navigate; RoomPage handles the actual join/reconnect on mount.
    navigate(`/room/${code}`);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
          className="mb-8 text-center"
        >
          <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">
            Play together,
            <br />
            <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent">
              from anywhere.
            </span>
          </h1>
          <p className="mt-3 text-lg text-ink-soft">
            Spin up a private room and share the link with a friend. First game up: Wordle.
          </p>
        </motion.div>

        <Card className="space-y-6">
          <Input
            label="Your nickname"
            placeholder="e.g. Alex"
            value={nickname}
            maxLength={16}
            onChange={(e) => setNick(e.target.value)}
          />

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-soft">Mode</span>
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={cx(
                    "rounded-xl border p-4 text-left transition-all",
                    mode === m.value
                      ? "border-brand bg-brand-soft/60 shadow-e2"
                      : "border-border bg-surface-2 hover:border-brand/50",
                  )}
                >
                  <div className="text-2xl">{m.icon}</div>
                  <div className="mt-1 font-semibold text-ink">{m.label}</div>
                  <div className="text-xs text-ink-mute">{m.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-soft">Match length</span>
            <div className="flex gap-2">
              {BEST_OF.map((n) => (
                <button
                  key={n}
                  onClick={() => setBestOf(n)}
                  className={cx(
                    "flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all",
                    bestOf === n
                      ? "border-brand bg-brand text-white"
                      : "border-border bg-surface-2 text-ink-soft hover:border-brand/50",
                  )}
                >
                  {n === 1 ? "Single" : `Best of ${n}`}
                </button>
              ))}
            </div>
          </div>

          <Button size="lg" fullWidth loading={busy === "create"} onClick={handleCreate}>
            Create private room
          </Button>
        </Card>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-sm font-medium text-ink-mute">or join a friend</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Room code"
                placeholder="ABC123"
                value={joinCode}
                maxLength={6}
                autoCapitalize="characters"
                className="uppercase tracking-wide font-display"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
            </div>
            <Button
              variant="secondary"
              size="lg"
              loading={busy === "join"}
              onClick={handleJoin}
              className="sm:w-32"
            >
              Join
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
