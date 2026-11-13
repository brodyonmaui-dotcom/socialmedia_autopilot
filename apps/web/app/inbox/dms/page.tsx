import Link from "next/link";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { counts, listDmThreads, relativeTime } from "../../../lib/engagement/queries.js";
import { Banner, PlatformBadge } from "../../batches/ui/WarningChip.js";
import { copyDraftAction } from "../actions.js";
import { CopyButton } from "../ui/CommentCard.js";
import { DmCountdown } from "../ui/DmCountdown.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
/** Instagram handles only: letters, digits, dot, underscore. Anything else gets no deep link. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

function Tabs({ c }: { c: { flagged: number; shadow: number; dmsOpen: number } }) {
  const tabs: Array<[string, string, boolean]> = [
    [`Flagged ${c.flagged}`, "/inbox", false],
    [`Shadow ${c.shadow}`, "/inbox?tab=shadow", false],
    ["Sent", "/inbox?tab=sent", false],
    [`DMs ${c.dmsOpen}`, "/inbox/dms", true],
  ];
  return (
    <nav className="mt-2 grid grid-cols-4 gap-1">
      {tabs.map(([label, href, current]) => (
        <Link
          key={href}
          href={href}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg px-1 text-[15px] ${current ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default async function DmsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const now = new Date();
  const [c, threads] = await Promise.all([counts(pool, now), listDmThreads(pool, now)]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16 text-base">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <Tabs c={c} />
      <Banner kind="error" text={param(sp.error)} />
      <p className="mt-3 text-sm text-neutral-500">Read + draft only. You answer every DM yourself in the Instagram app.</p>

      {threads.length === 0 ? (
        <p className="mt-6 text-neutral-500">No DM threads yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {threads.map((t) => (
            <li key={t.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform="instagram" />
                <span className="font-semibold">{t.handle ? `@${t.handle}` : "unknown"}</span>
                {t.lastInboundAt ? <span className="text-sm text-neutral-500">{relativeTime(t.lastInboundAt, now)}</span> : null}
              </div>
              <div className="mt-1">
                <DmCountdown lastInboundAt={t.lastInboundAt} initialNow={now.toISOString()} />
              </div>
              <ul className="mt-2 space-y-1">
                {t.messages.slice(-3).map((m) => (
                  <li
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-base ${m.dir === "in" ? "bg-neutral-100 dark:bg-neutral-900" : "ml-auto bg-sky-100 dark:bg-sky-950"}`}
                  >
                    {m.text}
                  </li>
                ))}
              </ul>
              {t.draft ? (
                <div className="mt-3 rounded-lg border border-dashed border-neutral-300 p-2 dark:border-neutral-700">
                  <p className="text-sm text-neutral-500">draft{t.draft.bucket ? ` · ${t.draft.bucket}` : ""}</p>
                  <p className="text-base">{t.draft.text}</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {t.draft ? <CopyButton text={t.draft.text} onCopied={copyDraftAction.bind(null, t.draft.id)} /> : null}
                {t.handle && HANDLE.test(t.handle) ? (
                  <a
                    href={`https://ig.me/m/${t.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-300 px-4 text-base font-medium dark:border-neutral-700"
                  >
                    Open Instagram
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
