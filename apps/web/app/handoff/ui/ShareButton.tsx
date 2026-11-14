"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button, Icon } from "../../../components/ui/index.js";
import { shareLabel } from "../../../lib/handoff/view.js";
import { buttonFor, prepare, share, type ShareState } from "./share-machine.js";

/**
 * Two taps: Prepare (download the clip) → Share (iOS share sheet → Snapchat). Never logs the URL.
 * The state lives in HandoffCard so the prepared File can also feed the preview frame.
 */
export function ShareButton({
  itemId,
  caption,
  blocks,
  state,
  setState,
}: {
  itemId: string;
  caption: string;
  blocks: string[];
  state: ShareState;
  setState: Dispatch<SetStateAction<ShareState>>;
}) {
  const b = blocks.length > 0 ? buttonFor({ kind: "blocked" }) : buttonFor(state);

  async function onTap() {
    if (b.action === "prepare") {
      setState({ kind: "preparing" });
      setState(await prepare((u, i) => fetch(u, i), itemId, blocks));
    } else if (b.action === "share" && "file" in state && state.file && state.sizeMb) {
      // No await before share(): it must run inside this tap's user gesture.
      const { file, sizeMb } = state;
      const pending = share(typeof navigator === "undefined" ? undefined : navigator, file, sizeMb, caption);
      setState({ kind: "sharing", file, sizeMb });
      setState(await pending);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="solid" block disabled={b.disabled} aria-disabled={b.disabled} onClick={onTap}>
        {b.action === "share" ? <Icon name="share" size={18} /> : null}
        {shareLabel(b.label)}
      </Button>
      <p aria-live="polite" className="ds-mono min-h-4 text-ds-muted">
        {state.kind === "ready" ? `Ready: ${state.sizeMb} MB. Tap Share.` : null}
        {state.kind === "shared" ? "Sent to the share sheet. Mark posted once it's up." : null}
      </p>
      {state.kind === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-[15px] leading-snug text-ds-danger">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
