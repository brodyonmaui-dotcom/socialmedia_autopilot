import { redirect } from "next/navigation";
import { requireSession } from "../../../lib/auth/require.js";
import type { SearchParams } from "../../../components/research/ResearchFrame.js";

export const dynamic = "force-dynamic";

/** Old route: the Ideas tab is /research now. Keeps the query (?error= from the add/move actions, filters). */
export default async function IdeasRedirect({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string" && ["error", "note", "source", "pillar"].includes(k)) q.set(k, v.slice(0, 200));
  const s = q.toString();
  redirect(s ? `/research?${s}` : "/research");
}
