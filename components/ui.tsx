import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-0.5 text-[1.7rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-sm border border-line bg-surface ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
          {aside ? <div className="text-xs text-ink-3">{aside}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  ok: "bg-ok-soft text-ok border-ok/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  bad: "bg-bad-soft text-bad border-bad/25",
  info: "bg-info-soft text-info border-info/25",
  accent: "bg-accent-soft text-accent-strong border-accent/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  const bar: Record<Tone, string> = {
    neutral: "bg-line-strong",
    ok: "bg-ok",
    warn: "bg-[#c98a00]",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  };
  return (
    <div className="relative overflow-hidden rounded-sm border border-line bg-surface px-4 py-3">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar[tone]}`} />
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-[1.65rem] font-semibold leading-none tracking-tight">{value}</p>
      {detail ? <p className="mt-1.5 text-xs text-ink-2">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-sm border px-3 py-2 text-sm ${TONE[tone]}`}>
      {children}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-sm font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50",
};

export const inputClass =
  "h-8 rounded-sm border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-3";
