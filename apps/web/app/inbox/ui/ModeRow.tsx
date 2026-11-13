"use client";

import { useState } from "react";
import type { EngagementPlatform, Mode } from "@autopilot/engagement";
import { BTN_GHOST, BTN_PRIMARY, PlatformBadge } from "../../batches/ui/WarningChip.js";
import { setModeAction } from "../actions.js";

const MODES: readonly Mode[] = ["off", "shadow", "live"];
const NAME: Record<EngagementPlatform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };

/** off / shadow switch directly; live opens a confirm sheet first. */
export function ModeRow({ platform, mode, tab }: { platform: EngagementPlatform; mode: Mode; tab: string }) {
  const [confirm, setConfirm] = useState(false);
  const tabField = <input type="hidden" name="tab" value={tab} />;

  return (
    <li className="flex items-center gap-2 py-2">
      <PlatformBadge platform={platform} />
      <span className="w-20 text-base">{NAME[platform]}</span>
      <div className="ml-auto flex gap-1">
        {MODES.map((m) =>
          m === mode ? (
            <span key={m} className="inline-flex min-h-11 items-center rounded-lg bg-neutral-900 px-3 text-base font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" aria-current="true">
              {m}
            </span>
          ) : m === "live" ? (
            <button key={m} type="button" className={`${BTN_GHOST} px-3`} onClick={() => setConfirm(true)}>
              live
            </button>
          ) : (
            <form key={m} action={setModeAction.bind(null, platform, m)}>
              {tabField}
              <button className={`${BTN_GHOST} px-3`}>{m}</button>
            </form>
          ),
        )}
      </div>

      {confirm ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setConfirm(false)}>
          <form
            action={setModeAction.bind(null, platform, "live")}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Set ${platform} live`}
            className="mx-auto w-full max-w-2xl space-y-3 rounded-t-2xl bg-white p-4 pb-8 dark:bg-neutral-900"
          >
            {tabField}
            <h2 className="text-lg font-semibold">Set {NAME[platform]} to live?</h2>
            <p className="text-base">
              Changing auto-reply behaviour: confirm with Claude in chat first. Live sending also needs DRY_RUN=false on the worker.
            </p>
            <div className="flex gap-2">
              <button className={`${BTN_PRIMARY} flex-1`}>Confirm</button>
              <button type="button" className={BTN_GHOST} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </li>
  );
}
