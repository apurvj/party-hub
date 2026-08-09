import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Logo, ThemeToggle } from "../design-system/index.js";

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="app-aurora relative min-h-full">
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <Link to="/" className="group rounded-lg" aria-label="Party Hub - home">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          {right}
          <ThemeToggle />
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-16">{children}</main>
    </div>
  );
}
