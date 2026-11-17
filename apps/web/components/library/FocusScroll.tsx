"use client";

import { useEffect } from "react";

/** Scrolls the element with `targetId` to the middle of the screen once (Library `?focus=`). No smooth scroll: nothing moves on its own. */
export function FocusScroll({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [targetId]);
  return null;
}
