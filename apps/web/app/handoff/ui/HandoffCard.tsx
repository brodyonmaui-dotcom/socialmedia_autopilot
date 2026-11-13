"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult, HandoffItem } from "../../../lib/handoff/types.js";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, INPUT, PlatformBadge } from "../../batches/ui/WarningChip.js";
import { CopyButton } from "../../inbox/ui/CommentCard.js";
import { dropAction, markPostedAction, skipAction } from "../actions.js";
import { ConfirmSheet } from "./ConfirmSheet.js";
import { ShareButton } from "./ShareButton.js";

const isLocationLine = (line: string) => /location|snap map/i.test(line);

function resultText(r: ActionResult, verb: string): string {
  if (r.ok) return r.to ? `${verb}: moved to ${r.to}.` : `${verb}.`;
  return /changed|reload|not found|0 rows/i.test(r.reason) ? "Changed underneath: reload." : r.reason.slice(0, 160);
}

export function HandoffCard({ item, when }: { item: HandoffItem; when: string }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"posted" | "drop" | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(verb: string, fn: () => Promise<ActionResult>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: resultText(r, verb) });
      setSheet(null);
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <PlatformBadge platform="snapchat" />
        <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
        {item.durationS != null ? <span className="text-sm text-neutral-500">{Math.round(item.durationS)} s</span> : null}
      </div>
      <p className="mt-1 text-sm text-neutral-500">{when}</p>

      <div className="mt-2 flex items-start gap-2">
        <p className="flex-1 whitespace-pre-wrap rounded-lg bg-neutral-100 p-2 text-base dark:bg-neutral-900">
          {item.caption || <span className="text-neutral-500">(no caption)</span>}
        </p>
        {item.caption ? <CopyButton text={item.caption} /> : null}
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {item.checklist.map((line, i) =>
          isLocationLine(line) ? (
            <li key={i} className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              ⚠ {line}
            </li>
          ) : (
            <li key={i} className="px-2 text-neutral-600 dark:text-neutral-300">
              ☐ {line}
            </li>
          ),
        )}
      </ul>

      {item.blocks.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {item.blocks.map((b, i) => (
            <li key={i} className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <span className="font-medium">Blocked</span>: {b}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex gap-2">
        <ShareButton itemId={item.id} caption={item.caption} blocks={item.blocks} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={`${BTN_GHOST} flex-1`} disabled={busy} onClick={() => setSheet("posted")}>
          Mark posted
        </button>
        <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => run("Skipped", () => skipAction(item.id))}>
          Skip today
        </button>
        <button type="button" className={BTN_DANGER} disabled={busy} onClick={() => setSheet("drop")}>
          Drop
        </button>
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
          {msg.text}
        </p>
      ) : null}

      <ConfirmSheet
        open={sheet === "posted"}
        title="Mark as posted on Spotlight?"
        confirmLabel="Confirm: posted"
        confirmClass={BTN_PRIMARY}
        busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() => run("Marked posted", () => markPostedAction(item.id, url.trim() || null))}
      >
        <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">Only once it&apos;s live on Spotlight. This can&apos;t be undone here.</p>
        <label className="mt-3 block text-sm text-neutral-500">
          Spotlight link (optional)
          <input type="url" inputMode="url" placeholder="https://…snapchat.com/…" value={url} onChange={(e) => setUrl(e.target.value)} className={INPUT} />
        </label>
      </ConfirmSheet>
      <ConfirmSheet
        open={sheet === "drop"}
        title="Drop this Snapchat post?"
        confirmLabel="Confirm: drop"
        confirmClass={BTN_DANGER}
        busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() => run("Dropped", () => dropAction(item.id))}
      >
        <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">It&apos;s rejected and won&apos;t come back. Skip today moves it to the next free day instead.</p>
      </ConfirmSheet>
    </li>
  );
}
