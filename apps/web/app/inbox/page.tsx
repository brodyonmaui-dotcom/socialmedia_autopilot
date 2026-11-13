import Link from "next/link";
import type { EngagementPlatform } from "@autopilot/engagement";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { counts, listInbox, relativeTime, type InboxTab } from "../../lib/engagement/queries.js";
import { loadEngagement } from "../../lib/engagement/settings.js";
import { Banner } from "../batches/ui/WarningChip.js";
import { CommentCard } from "./ui/CommentCard.js";
import { KillSwitch } from "./ui/KillSwitch.js";
import { ModeRow } from "./ui/ModeRow.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
const PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];

const EMPTY: Record<Exclude<InboxTab, "dms">, string> = {
  flagged: "Nothing flagged. Comments that need you show up here.",
  shadow: "No shadow replies yet. In shadow mode the worker stores what it would have said here.",
  sent: "Nothing has gone out yet.",
};

function InboxTabs({ current, c }: { current: InboxTab; c: { flagged: number; shadow: number; dmsOpen: number } }) {
  const tabs: Array<[InboxTab, string, string]> = [
    ["flagged", `Flagged ${c.flagged}`, "/inbox"],
    ["shadow", `Shadow ${c.shadow}`, "/inbox?tab=shadow"],
    ["sent", "Sent", "/inbox?tab=sent"],
    ["dms", `DMs ${c.dmsOpen}`, "/inbox/dms"],
  ];
  return (
    <nav className="mt-2 grid grid-cols-4 gap-1">
      {tabs.map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg px-1 text-[15px] ${key === current ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const raw = param(sp.tab);
  const tab: Exclude<InboxTab, "dms"> = raw === "shadow" || raw === "sent" ? raw : "flagged";
  const pool = getPool();
  const now = new Date();
  const [settings, c, rows] = await Promise.all([loadEngagement(pool), counts(pool, now), listInbox(pool, tab)]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16 text-base">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <InboxTabs current={tab} c={c} />
      <Banner kind="error" text={param(sp.error)} />
      <Banner kind="note" text={param(sp.note)} />

      <KillSwitch killed={settings.killed} reason={settings.killedReason} tab={tab} />
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {PLATFORMS.map((p) => (
          <ModeRow key={p} platform={p} mode={settings.mode[p]} tab={tab} />
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="mt-6 text-neutral-500">{EMPTY[tab]}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <CommentCard key={`${r.commentId}-${r.actionId ?? ""}`} row={r} tab={tab} when={relativeTime(r.commentedAt, now)} />
          ))}
        </ul>
      )}
    </main>
  );
}
