import { motion } from "framer-motion";
import { useTheme } from "./ThemeProvider.js";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative h-10 w-10 rounded-full border border-border bg-surface text-ink-soft grid place-items-center hover:bg-surface-2 transition-colors"
    >
      <motion.span
        key={theme}
        initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 24 }}
        className="text-lg"
      >
        {isDark ? "🌙" : "☀️"}
      </motion.span>
    </button>
  );
}
