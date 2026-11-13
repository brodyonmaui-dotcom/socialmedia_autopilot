"use client";

import { useState } from "react";
import { BTN_PRIMARY } from "../../batches/ui/WarningChip.js";
import { buttonFor, initialState, prepare, share, type ShareState } from "./share-machine.js";

/** Two taps: Prepare (download the clip) → Share (iOS share sheet → Snapchat). Never logs the URL. */
export function ShareButton({ itemId, caption, blocks }: { itemId: string; caption: string; blocks: string[] }) {
  const [state, setState] = useState<ShareState>(() => initialState(blocks));
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
    <div className="flex-1">
      <button type="button" className={`${BTN_PRIMARY} w-full`} disabled={b.disabled} onClick={onTap}>
        {b.label}
      </button>
      {state.kind === "ready" ? <p className="mt-1 text-sm text-neutral-500">Ready: {state.sizeMb} MB. Tap Share.</p> : null}
      {state.kind === "shared" ? <p className="mt-1 text-sm text-neutral-500">Sent to the share sheet. Mark posted once it&apos;s up.</p> : null}
      {state.kind === "error" ? (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
