import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cx } from "./cx.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-md select-none " +
  "transition-colors duration-150 ease-smooth disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-e2 hover:brightness-110",
  secondary: "bg-surface-2 text-ink border border-border hover:bg-surface",
  ghost: "bg-transparent text-ink-soft hover:bg-surface-2",
  danger: "bg-danger text-white shadow-e2 hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-base",
  lg: "h-14 px-7 text-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const isDisabled = disabled || loading;
  // Respect prefers-reduced-motion (no springy pop/lift), and don't lift/press a
  // disabled button — otherwise it snaps out of a hover offset when it disables.
  const interactive = !reduceMotion && !isDisabled;
  return (
    <motion.button
      ref={ref}
      whileTap={interactive ? { scale: 0.96 } : undefined}
      whileHover={interactive ? { y: -1 } : undefined}
      animate={isDisabled ? { y: 0, scale: 1 } : undefined}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
      className={cx(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      disabled={isDisabled}
      {...rest}
    >
      {loading && (
        <span
          className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
          aria-hidden
        />
      )}
      {children}
    </motion.button>
  );
});
