import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Panel } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { homeFor, isRole, ROLE_LABEL } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage({ searchParams }: PageProps<"/no-access">) {
  const user = await requireMinRole("viewer");
  const params = await searchParams;
  const need = isRole(params.need) ? params.need : null;
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Panel>
        <p className="eyebrow">403</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">This page is not available to the {ROLE_LABEL[user.role]} tier</h1>
        <p className="mt-2 text-ink-2">
          {need ? <>It needs the <strong>{ROLE_LABEL[need]}</strong> role or higher. </> : null}
          {user.viewingAs
            ? "You are previewing a lower tier. Use the View as control in the header to switch back."
            : "The same check runs on every page, server action and route handler, not only in the navigation."}
        </p>
        <div className="mt-4">
          <Link href={homeFor(user.role)} className={buttonClass.primary}>
            Go to a page you can open
          </Link>
        </div>
      </Panel>
    </div>
  );
}
