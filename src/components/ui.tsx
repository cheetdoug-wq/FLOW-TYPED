import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ step, title, children, aside }: { step?: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        {step !== undefined && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">{step}</span>
        )}
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const variants = {
  primary: "btn-primary font-semibold shadow-sm hover:brightness-110",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
};

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...p}
    />
  );
}

const noticeTones = {
  info: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Notice({ tone = "info", children, role }: { tone?: keyof typeof noticeTones; children: ReactNode; role?: string }) {
  return <div role={role} className={`fade-in rounded-lg px-3 py-2.5 text-[13px] leading-relaxed ${noticeTones[tone]}`}>{children}</div>;
}
