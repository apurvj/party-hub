import { AnimatePresence, motion } from "framer-motion";
import type { ConnStatus } from "../net/useRoom.js";

const copy: Record<ConnStatus, { text: string; tone: string } | null> = {
  connected: null,
  connecting: { text: "Connecting…", tone: "bg-info" },
  reconnecting: { text: "Reconnecting…", tone: "bg-warning" },
  disconnected: { text: "Connection lost - retrying…", tone: "bg-danger" },
};

/** Slim banner that only shows when something's off with the connection. */
export function ConnBar({ status }: { status: ConnStatus }) {
  const info = copy[status];
  return (
    <AnimatePresence>
      {info && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed inset-x-0 top-0 z-[90] flex justify-center"
        >
          <div className="mt-2 flex items-center gap-2 rounded-full bg-surface/90 px-4 py-1.5 text-sm font-medium text-ink shadow-e3 backdrop-blur">
            <span className={`h-2 w-2 animate-pulse rounded-full ${info.tone}`} />
            {info.text}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
