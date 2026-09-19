import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";
import { isDemoMode } from "@/lib/env";
import { COMPANY } from "@/lib/policy";
import { enterDemo } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const params = await searchParams;
  const err = typeof params.err === "string" ? params.err : null;

  const user = await getCurrentUser().catch(() => null);
  if (user) redirect(homeFor(user.role));

  const demo = isDemoMode();

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col justify-between bg-chrome px-8 py-10 text-chrome-ink lg:px-14 lg:py-14">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-base font-bold text-white">
            F
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">{COMPANY.product}</span>
        </div>
        <div className="max-w-md py-12">
          <p className="eyebrow !text-chrome-ink">{COMPANY.name}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-white lg:text-4xl">
            Daily reports, approved on time, and hours that add up.
          </h1>
          <ul className="mt-8 space-y-3 text-[0.95rem] leading-relaxed">
            <li>Bulk approve with a batch that survives an outage and resumes where it stopped.</li>
            <li>A six-week heatmap of claimed hours against tracked hours, by person and day.</li>
            <li>A directory with five role tiers and a read-only role preview.</li>
            <li>Reminders with an exactly-once log. In this demo nothing is ever sent.</li>
          </ul>
        </div>
        <p className="text-xs leading-relaxed text-chrome-ink/80">
          A public portfolio demo. Every person, team, client and number is invented.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-ink-2">
            Visitors share one demo account with the <strong>manager</strong> role. There is nothing to type.
          </p>

          {err ? (
            <p role="alert" className="mt-5 rounded-sm border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
              {err}
            </p>
          ) : null}

          {demo ? (
            <form action={enterDemo} className="mt-6">
              <button
                type="submit"
                className="w-full rounded-sm bg-accent px-4 py-2.5 text-[0.95rem] font-semibold text-white transition-colors hover:bg-accent-strong"
              >
                Enter demo
              </button>
            </form>
          ) : (
            <p role="alert" className="mt-6 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              Demo mode is off. Set DEMO_MODE=true on the server; it is the only supported mode.
            </p>
          )}

          <dl className="mt-8 space-y-2 border-t border-line pt-5 text-sm text-ink-2">
            <div className="flex justify-between gap-4">
              <dt>Data</dt>
              <dd className="text-right">Invented, resets nightly at 19:10 UTC</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Email</dt>
              <dd className="text-right">Never sent, only logged</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Integrations</dt>
              <dd className="text-right">Simulated</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
