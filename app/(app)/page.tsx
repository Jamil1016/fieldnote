import { redirect } from "next/navigation";
import { requireMinRole } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";

export default async function Home() {
  const user = await requireMinRole("viewer");
  redirect(homeFor(user.role));
}
