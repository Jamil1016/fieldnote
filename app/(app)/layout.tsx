import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/signin/actions";
import { TopNav } from "@/components/top-nav";
import { ViewAs } from "@/components/view-as";
import { requireMinRole } from "@/lib/auth/session";
import { homeFor, navFor, ROLE_LABEL } from "@/lib/auth/roles";
import { COMPANY } from "@/lib/policy";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // The layout needs a user to draw the navigation. Every page and action
  // below still runs its own guard; this one is not relied on for access.
  const user = await requireMinRole("viewer");
  const items = navFor(user.role);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-chrome text-chrome-ink">
        <div className="mx-auto flex h-12 max-w-[1500px] items-stretch gap-4 px-4 lg:px-6">
          <Link href={homeFor(user.role)} className="flex shrink-0 items-center gap-2.5 pr-2">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-sm bg-accent text-xs font-bold text-white">
              F
            </span>
            <span className="text-[0.98rem] font-semibold tracking-tight text-white">{COMPANY.product}</span>
          </Link>
          <TopNav items={items} />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ViewAs actualRole={user.actualRole} currentRole={user.role} />
            <div className="hidden text-right leading-tight md:block">
              <div className="text-xs font-medium text-white">{user.displayName}</div>
              <div className="text-[0.7rem] text-chrome-ink">{ROLE_LABEL[user.actualRole]}</div>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="grid h-7 w-7 place-items-center rounded-sm text-chrome-ink hover:bg-white/10 hover:text-white"
              >
                <LogOut size={15} aria-hidden />
              </button>
            </form>
          </div>
        </div>
        <div className="border-t border-white/10 bg-chrome-2">
          <p className="mx-auto max-w-[1500px] px-4 py-1.5 text-xs text-chrome-ink lg:px-6">
            <strong className="font-semibold text-white">Demo data.</strong> Every person, team and number here is invented.
            Nothing is sent. Data resets nightly.
          </p>
        </div>
        {user.viewingAs ? (
          <div role="status" className="border-t border-warn/30 bg-warn-soft text-warn">
            <p className="mx-auto max-w-[1500px] px-4 py-1.5 text-xs lg:px-6">
              <strong className="font-semibold">Previewing the {ROLE_LABEL[user.role]} tier.</strong> Navigation and page
              access match that tier. You are still signed in as a {ROLE_LABEL[user.actualRole]}; changes are blocked until
              you switch back.
            </p>
          </div>
        ) : null}
      </header>
      <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 lg:px-6">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-[1500px] px-4 pb-6 text-xs text-ink-3 lg:px-6">
        {COMPANY.name} is fictional. All times are UTC.
      </footer>
    </div>
  );
}
