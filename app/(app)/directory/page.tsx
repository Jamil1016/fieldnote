import type { Metadata } from "next";
import { DirectoryTable } from "@/components/directory/directory-table";
import { PageHeader, Panel } from "@/components/ui";
import { requireMinRole } from "@/lib/auth/session";
import { listDirectory } from "@/lib/data/directory";
import { COMPANY } from "@/lib/policy";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Directory" };

export default async function DirectoryPage() {
  await requireMinRole("viewer");
  const rows = await listDirectory(createServiceClient());
  const teams = new Set(rows.map((r) => r.team_id)).size;
  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="People and teams"
        description={`${rows.length} people in ${teams} teams at ${COMPANY.name}. Every name here is invented. Open a person to see how reliably they file and how their claimed hours compare with the timer.`}
      />
      <Panel flush>
        <DirectoryTable rows={rows} />
      </Panel>
    </>
  );
}
