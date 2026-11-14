"use client";

import { useEffect, useState } from "react";
import { dmWindow, dmWindowLabel } from "@autopilot/engagement/src/dm.js";
import { Icon, cx } from "../../../components/ui/index.js";
import { dmWindowTone } from "../../../lib/inbox/view.js";

const TONE = { accent: "text-ds-accent-fg", warn: "text-ds-warn", muted: "text-ds-faint" } as const;

/** Instagram's 24 h reply window for a thread; re-renders every 30 s. `initialNow` keeps SSR and hydration in step. */
export function DmCountdown({ lastInboundAt, initialNow }: { lastInboundAt: string | null; initialNow: string }) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!lastInboundAt) return <span className="ds-mono text-ds-faint">no message from them yet</span>;
  const w = dmWindow(lastInboundAt, now);
  const tone = dmWindowTone(w);
  return (
    <span className={cx("ds-mono inline-flex items-center gap-1.5", TONE[tone])}>
      <Icon name={tone === "warn" ? "alert" : "clock"} size={14} />
      {dmWindowLabel(w)}
    </span>
  );
}
