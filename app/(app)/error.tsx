"use client";

import { buttonClass } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-sm border border-bad/30 bg-surface p-5">
      <p className="eyebrow !text-bad">Something went wrong</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">This page could not load its data</h1>
      <p className="mt-2 text-ink-2">
        The database may be unreachable or the demo schema may not be installed yet. Nothing was changed.
      </p>
      {error.digest ? <p className="num mt-2 text-xs text-ink-3">Reference {error.digest}</p> : null}
      <button type="button" onClick={reset} className={`${buttonClass.primary} mt-4`}>
        Try again
      </button>
    </div>
  );
}
