"use client";

import { useState } from "react";
import { BTN_GHOST, BTN_PRIMARY, INPUT } from "../../batches/ui/WarningChip.js";
import { setKillAction } from "../actions.js";

/** Killing is one tap; resuming needs the word "resume" typed (checked again on the server). */
export function KillSwitch({ killed, reason, tab }: { killed: boolean; reason?: string | undefined; tab: string }) {
  const [resuming, setResuming] = useState(false);
  const [word, setWord] = useState("");

  if (!killed) {
    return (
      <form action={setKillAction.bind(null, true)} className="mt-4 rounded-xl border border-green-300 p-3 dark:border-green-900">
        <input type="hidden" name="tab" value={tab} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold">Auto-replies: ON</span>
          <button className="min-h-11 rounded-lg bg-red-600 px-4 text-base font-semibold text-white">Kill</button>
        </div>
        <input name="reason" placeholder="reason (optional)" className={`${INPUT} mt-2`} maxLength={200} />
      </form>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-red-400 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-red-800 dark:text-red-200">
          Auto-replies: KILLED{reason ? ` (${reason})` : ""}
        </span>
        {!resuming ? (
          <button type="button" className={BTN_GHOST} onClick={() => setResuming(true)}>
            Resume…
          </button>
        ) : null}
      </div>
      {resuming ? (
        <form action={setKillAction.bind(null, false)} className="mt-2 space-y-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="block text-sm text-neutral-600 dark:text-neutral-300">
            Type <b>resume</b> to turn auto-replies back on (each platform still follows its mode).
            <input name="confirm" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" className={INPUT} />
          </label>
          <div className="flex gap-2">
            <button className={BTN_PRIMARY} disabled={word.trim().toLowerCase() !== "resume"}>
              Resume
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setResuming(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
