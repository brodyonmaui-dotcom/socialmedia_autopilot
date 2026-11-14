"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Readout, Sheet } from "../../../components/ui/index.js";
import { AddClipSheet, type PickerMedia } from "./AddClipSheet.js";
import { WarningLine } from "./Notice.js";

function Pending({ children, variant, disabled }: { children: React.ReactNode; variant: "solid" | "outline"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const off = pending || disabled === true;
  return (
    <Button type="submit" variant={variant} block disabled={off} aria-disabled={off} className="sm:min-w-32">
      {pending ? "Working…" : children}
    </Button>
  );
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The batch's actions inside the Approval cell: "Approve all" (solid, opens the confirm Sheet; it never
 * approves directly), Fill times and Add clip (outline). Counts come from the server-side approve-all plan.
 */
export function ApproveBar(props: {
  batchId: string;
  approvable: number;
  warnCount: number;
  skipped: Array<{ itemId: string; label: string; reasons: string[] }>;
  untimedCount: number;
  media: PickerMedia[];
  approveAll: () => Promise<void>;
  fillTimes: () => Promise<void>;
  addItem: (fd: FormData) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const close = () => setConfirm(false);
  const n = props.approvable;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button variant="solid" block arrow disabled={n === 0} aria-disabled={n === 0} onClick={() => setConfirm(true)}>
          {n > 0 ? `Approve all ${n}` : "Nothing to approve"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <form action={props.fillTimes}>
            <Pending variant="outline">Fill times{props.untimedCount ? ` (${props.untimedCount})` : ""}</Pending>
          </form>
          <Button variant="outline" block onClick={() => setAdding(true)}>
            Add clip
          </Button>
        </div>
      </div>

      <Sheet
        open={confirm}
        onClose={close}
        title={n === 0 ? "Nothing to approve yet" : `Approve ${n} post${n === 1 ? "" : "s"}?`}
        footer={
          <form
            className="contents"
            action={async () => {
              await props.approveAll();
              close();
            }}
          >
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Pending variant="solid" disabled={n === 0}>
              Approve {n}
            </Pending>
          </form>
        }
      >
        <div className="flex flex-col gap-5">
          <p>
            {n === 0
              ? "Fix the blocked posts first: they stay as drafts."
              : "Approved posts go into the outbox for their times. Blocked ones stay as drafts; you can pull any post back until it publishes."}
          </p>
          <Readout
            items={[
              { k: "Approve", v: two(n) },
              { k: "Blocked", v: two(props.skipped.length) },
              { k: "Warnings", v: two(props.warnCount) },
            ]}
          />
          {props.skipped.length > 0 ? (
            <ul className="flex flex-col gap-3 border-t border-ds-line pt-4">
              {props.skipped.map((s) => (
                <li key={s.itemId} className="flex flex-col gap-2">
                  <p className="ds-caps text-ds-text">{s.label}</p>
                  {s.reasons.map((r, i) => (
                    <WarningLine key={i} tone="danger" label="Blocked">
                      {r}
                    </WarningLine>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Sheet>

      <AddClipSheet open={adding} onClose={() => setAdding(false)} batchId={props.batchId} media={props.media} action={props.addItem} />
    </>
  );
}
