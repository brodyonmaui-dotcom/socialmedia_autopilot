"use client";

import { useState } from "react";
import type { EngagementPlatform, Mode } from "@autopilot/engagement";
import { Button, ListRow, SegmentBar, SegmentButton, Sheet, StatusPulse } from "../../../components/ui/index.js";
import { modePulse, PLATFORM_NAME } from "../../../lib/inbox/view.js";
import { setModeAction } from "../actions.js";

const MODES: readonly Mode[] = ["off", "shadow", "live"];

/** One platform's auto-reply mode: off / shadow submit directly; live opens a confirm Sheet first. */
export function ModeRow({ platform, mode, killed, tab }: { platform: EngagementPlatform; mode: Mode; killed: boolean; tab: string }) {
  const [confirm, setConfirm] = useState(false);
  const pulse = modePulse(mode, killed);
  const name = PLATFORM_NAME[platform];

  return (
    <ListRow avatar={{ platform }} title={name} trailing={<StatusPulse label={pulse.label} tone={pulse.tone} />}>
      <form>
        <input type="hidden" name="tab" value={tab} />
        <SegmentBar ariaLabel={`${name} auto-reply mode`}>
          {MODES.map((m) =>
            m === mode ? (
              <SegmentButton key={m} active type="button">
                {m}
              </SegmentButton>
            ) : m === "live" ? (
              <SegmentButton key={m} active={false} type="button" onClick={() => setConfirm(true)}>
                live
              </SegmentButton>
            ) : (
              <SegmentButton key={m} active={false} formAction={setModeAction.bind(null, platform, m)}>
                {m}
              </SegmentButton>
            ),
          )}
        </SegmentBar>
      </form>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Set ${name} to live?`}
        footer={
          <form action={setModeAction.bind(null, platform, "live")} className="contents">
            <input type="hidden" name="tab" value={tab} />
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" className="sm:min-w-32">
              Confirm live
            </Button>
          </form>
        }
      >
        <p className="ds-note">
          Changing auto-reply behaviour: confirm with Claude in chat first. Live sending also needs DRY_RUN=false on the worker (plus its live flag).
          Only replies still planned after the switch can go out; old shadow rows never do.
        </p>
      </Sheet>
    </ListRow>
  );
}
