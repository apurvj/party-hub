import { motion } from "framer-motion";
import { useState } from "react";
import { useToast } from "./Toast.js";

interface RoomCodePillProps {
  code: string;
  /** Full shareable URL; if provided, copy copies the link, else the code. */
  shareUrl?: string;
}

export function RoomCodePill({ code, shareUrl }: RoomCodePillProps) {
  const { show } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = shareUrl ?? code;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      show(shareUrl ? "Invite link copied!" : "Room code copied!", "success");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      show("Couldn't copy — long-press to copy manually.", "warning");
    }
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={copy}
      className="group inline-flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2.5 hover:border-brand transition-colors"
      aria-label={`Room code ${code.split("").join(" ")}. Tap to copy invite link.`}
    >
      <div className="flex gap-1">
        {code.split("").map((ch, i) => (
          <span
            key={i}
            className="grid h-8 w-7 place-items-center rounded-md bg-surface font-display text-lg font-bold text-ink shadow-e1"
          >
            {ch}
          </span>
        ))}
      </div>
      <span className="text-sm font-medium text-ink-soft group-hover:text-brand">
        {copied ? "Copied ✓" : shareUrl ? "Copy link" : "Copy"}
      </span>
    </motion.button>
  );
}
