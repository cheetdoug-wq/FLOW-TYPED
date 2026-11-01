"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Moon, Sun } from "./icons";

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ft-theme", next ? "dark" : "light"); } catch { /* preference just won't persist */ }
    setDark(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flow Typed home">
          <span aria-hidden="true" className="brand-gradient flex size-7 items-center justify-center rounded-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
              <path d="M4 7c4-3 6 3 10 0s5-1 6 0M4 13c4-3 6 3 10 0M4 19h7" />
            </svg>
          </span>
          <span className="text-sm font-bold tracking-[0.16em]">FLOW TYPED</span>
        </Link>
        <div className="flex-1" />
        {children}
        <Link href="/privacy" className="hidden rounded-lg px-3 py-2 text-sm text-muted transition hover:text-ink sm:block">Privacy</Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
