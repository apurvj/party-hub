import { forwardRef, type InputHTMLAttributes } from "react";
import { cx } from "./cx.js";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, invalid, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>}
      <input
        ref={ref}
        id={inputId}
        className={cx(
          "w-full h-12 rounded-md border bg-surface px-4 text-base text-ink placeholder:text-ink-mute",
          "transition-colors duration-150 ease-smooth",
          invalid ? "border-danger" : "border-border focus:border-brand",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {hint && (
        <span className={cx("mt-1.5 block text-xs", invalid ? "text-danger" : "text-ink-mute")}>
          {hint}
        </span>
      )}
    </label>
  );
});
