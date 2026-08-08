import { motion } from "framer-motion";
import type { RoomStatePayload } from "@party-hub/shared";
import { Card, PlayerBadge, RoomCodePill } from "../design-system/index.js";

export function Lobby({ room, shareUrl }: { room: RoomStatePayload; shareUrl: string }) {
  const you = room.you;
  const opponent = room.players.find((p) => !p.isYou) ?? null;

  return (
    <div className="mx-auto max-w-lg pt-6">
      <Card className="text-center">
        <div className="mb-1 text-sm font-semibold uppercase tracking-wide text-brand">
          {room.config.wordle.mode === "coop" ? "Co-op Wordle" : "Race Wordle"}
        </div>
        <h2 className="font-display text-2xl font-bold text-ink">Your room is ready</h2>
        <p className="mt-1 text-ink-soft">Share this link so your friend can hop in.</p>

        <div className="my-6 flex justify-center">
          <RoomCodePill code={room.code} shareUrl={shareUrl} />
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-4">
          <div className="flex flex-col items-center gap-2">
            <PlayerBadge nickname={you.nickname} you seat={you.seat} connected />
          </div>
          <div className="flex flex-col items-center gap-2">
            {opponent ? (
              <PlayerBadge nickname={opponent.nickname} seat={opponent.seat} connected={opponent.connected} />
            ) : (
              <div className="flex items-center gap-2.5 text-ink-mute">
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                  className="grid h-10 w-10 place-items-center rounded-full border-2 border-dashed border-border"
                >
                  ⏳
                </motion.div>
                <span className="text-sm">Waiting for a friend…</span>
              </div>
            )}
          </div>
        </div>

        <p className="mt-5 text-xs text-ink-mute">
          Best of {room.config.wordle.bestOf} • Same word for both players • Refresh-safe
        </p>
      </Card>
    </div>
  );
}
