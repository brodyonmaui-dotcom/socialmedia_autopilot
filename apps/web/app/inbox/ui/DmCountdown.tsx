"use client";

import { useEffect, useState } from "react";
import { dmWindow, dmWindowLabel } from "@autopilot/engagement/src/dm.js";

/** Instagram's 24 h reply window for a thread; re-renders every 30 s. `initialNow` keeps SSR and hydration in step. */
export function DmCountdown({ lastInboundAt, initialNow }: { lastInboundAt: string | null; initialNow: string }) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!lastInboundAt) return <span className="text-sm text-neutral-500">no message from them yet</span>;
  const w = dmWindow(lastInboundAt, now);
  return (
    <span className={`text-sm font-medium ${w.open ? (w.msLeft < 3 * 3_600_000 ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300") : "text-neutral-500"}`}>
      {dmWindowLabel(w)}
    </span>
  );
}
