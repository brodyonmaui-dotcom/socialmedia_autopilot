"use client";

import { useEffect, useRef, useState } from "react";
import { setIgTrialReelsAction } from "../../app/settings/actions.js";
import { Toggle } from "../ui/index.js";

/** "Post Instagram reels as trial reels", off by default. Instagram may refuse; that reel then goes out as a regular reel. */
export function IgTrialReelsSwitch({ on, followers, min }: { on: boolean; followers: number | null; min: number }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [on]);
  const below = followers === null || followers < min;
  const count = followers === null ? "Follower count not known yet" : `${followers} followers now`;
  return (
    <form ref={form} action={setIgTrialReelsAction}>
      <input type="hidden" name="on" value={on ? "off" : "on"} readOnly />
      <Toggle
        label="Post Instagram reels as trial reels"
        description={`${count}${below ? `; available from ${min} followers.` : "."} ${
          on ? "On: reels without their own setting go out as trial reels; you graduate them in the Instagram app. A refused one goes out as a regular reel." : "Off: reels go out as regular reels."
        }`}
        checked={on}
        disabled={busy}
        onChange={() => {
          setBusy(true);
          form.current?.requestSubmit();
        }}
      />
    </form>
  );
}
