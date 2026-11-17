"use client";

import { useEffect, useState } from "react";
import { dmWindow } from "@autopilot/engagement/src/dm.js";
import { Icon, cx } from "../ui/index.js";
import { dmWindowText, dmWindowTone } from "../../lib/inbox/view.js";

const TONE = { accent: "text-ds-accent-fg", warn: "text-ds-warn", muted: "text-ds-muted" } as const;

/** Instagram's 24 h reply window as one helper line; refreshes every 30 s (text only, nothing animates). */
export function DmWindow({ lastInboundAt, initialNow }: { lastInboundAt: string; initialNow: string }) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const w = dmWindow(lastInboundAt, now);
  const tone = dmWindowTone(w);
  return (
    <p className={cx("flex items-center gap-1.5 text-[13px]", TONE[tone])}>
      <Icon name={tone === "warn" ? "alert" : "clock"} size={14} className="shrink-0" />
      {dmWindowText(w)}
    </p>
  );
}
