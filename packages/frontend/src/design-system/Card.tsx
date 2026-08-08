import { motion, type HTMLMotionProps } from "framer-motion";
import { cx } from "./cx.js";

interface CardProps extends HTMLMotionProps<"div"> {
  glass?: boolean;
}

export function Card({ glass, className, children, ...rest }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
      className={cx(
        "rounded-2xl border border-border shadow-e3 p-6",
        glass ? "bg-surface/80 backdrop-blur-xl" : "bg-surface",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
