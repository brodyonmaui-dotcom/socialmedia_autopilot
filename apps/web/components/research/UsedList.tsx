"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { markHookUsedAction, markIdeaUsedAction } from "../../app/research/actions.js";
import { Button, CheckButton, Icon, cx } from "../ui/index.js";

type Kind = "idea" | "hook";
type Gone = { id: string; kind: Kind; title: string; nowUsed: boolean; index: number };
type Ctx = { hide: (g: Omit<Gone, "index">) => void };

const UsedCtx = createContext<Ctx | null>(null);
const actionFor = (k: Kind) => (k === "idea" ? markIdeaUsedAction : markHookUsedAction);

/**
 * The "Used" tick: a tiny form that saves on tap (works without JS: the server action re-renders the list).
 * With JS, the card is swapped at once for an in-place "Undo" row by the surrounding UsedList.
 */
export function UsedToggle({ kind, id, used, title, back }: { kind: Kind; id: string; used: boolean; title: string; back: string }) {
  const ctx = useContext(UsedCtx);
  return (
    <form action={actionFor(kind)} onSubmit={() => ctx?.hide({ id, kind, title, nowUsed: !used })}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="used" value={String(!used)} />
      <input type="hidden" name="back" value={back} />
      <CheckButton checked={used} label="Used" aria-label={`Used: ${title}`} />
    </form>
  );
}

/**
 * The card list (a <ul>): server-rendered cards in, each keyed by id. A card ticked here leaves the list
 * and its slot shows "Moved to Already used · Undo" until the next tick or a reload. Nothing overlays the page.
 */
export function UsedList({ items, label, className, resetKey, backTo }: { items: { id: string; node: ReactNode }[]; label: string; className?: string; resetKey?: string; backTo: string }) {
  const [gone, setGone] = useState<Gone[]>([]);
  useEffect(() => setGone([]), [resetKey]);

  const hide: Ctx["hide"] = (g) => {
    const index = items.findIndex((i) => i.id === g.id);
    setGone((prev) => [...prev.filter((p) => p.id !== g.id), { ...g, index: index < 0 ? items.length : index }]);
  };
  const undo = (id: string) => setGone((prev) => prev.filter((p) => p.id !== id));

  const goneIds = new Set(gone.map((g) => g.id));
  const rows: ReactNode[] = items.filter((i) => !goneIds.has(i.id)).map((i) => <li key={i.id} className="flex min-w-0">{i.node}</li>);
  for (const g of [...gone].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(g.index, rows.length), 0, <UndoRow key={`undo-${g.id}`} g={g} back={backTo} onUndo={() => undo(g.id)} />);
  }

  return (
    <UsedCtx.Provider value={{ hide }}>
      <ul aria-label={label} className={cx("grid grid-cols-1 gap-3 lg:gap-4", className)}>
        {rows}
      </ul>
    </UsedCtx.Provider>
  );
}

function UndoRow({ g, back, onUndo }: { g: Gone; back: string; onUndo: () => void }) {
  const where = g.nowUsed ? "Already used" : g.kind === "idea" ? "Ideas" : "Hooks";
  return (
    <li role="status" className="flex min-h-12 items-center gap-3 self-start rounded-ds-lg border border-ds-line bg-ds-card px-4 py-2">
      <Icon name="check" size={18} className="shrink-0 text-ds-accent-fg" />
      <p className="min-w-0 flex-1 text-[15px] leading-snug text-ds-text">
        Moved to {where}
        <span className="sr-only">: {g.title}</span>.
      </p>
      <form action={actionFor(g.kind)} onSubmit={onUndo}>
        <input type="hidden" name="id" value={g.id} />
        <input type="hidden" name="used" value={String(!g.nowUsed)} />
        <input type="hidden" name="back" value={back} />
        <Button type="submit" variant="ghost" size="sm" className="-mr-2">
          Undo
        </Button>
      </form>
    </li>
  );
}
