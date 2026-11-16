"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SearchResponse, SearchResult } from "../../lib/search/shape.js";
import { cx } from "./cx.js";
import { Dialog } from "./Dialog.js";
import { Icon } from "./Icon.js";
import { IconButton } from "./IconButton.js";
import { nextIndex } from "./popover-position.js";

/** True when a keypress should open the palette: ⌘K / Ctrl K anywhere, "/" outside text fields. */
export function isPaletteShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null }): boolean {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") return true;
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable);
}

/**
 * The top bar's Search button + the palette: a top-anchored Dialog (560 px) with one input and results
 * grouped as Pages, Posts, Ideas, Clips from GET /app/api/search. Arrow keys move, Enter opens.
 * ⌘K / Ctrl K and "/" open it.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();
  const listId = useId();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!open && isPaletteShortcut(e)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/app/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal, headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : { q: term, groups: [] }))
        .then((d: SearchResponse) => {
          setData(d);
          setActive(d.groups.length ? 0 : -1);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const flat: SearchResult[] = useMemo(() => data?.groups.flatMap((g) => g.results) ?? [], [data]);

  function close() {
    setOpen(false);
    setQ("");
    setData(null);
    setActive(-1);
    requestAnimationFrame(() => btn.current?.focus());
  }
  function go(r: SearchResult) {
    close();
    router.push(r.href);
  }
  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const r = flat[active];
      if (r) {
        e.preventDefault();
        go(r);
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const n = nextIndex(e.key, active, flat.length);
    if (n != null) {
      e.preventDefault();
      setActive(n);
      document.getElementById(`${listId}-${n}`)?.scrollIntoView({ block: "nearest" });
    }
  }

  const term = q.trim();
  let idx = -1;
  return (
    <>
      <IconButton ref={btn} icon="search" label="Search" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K /" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} title="Search" hideTitle placement="top" size="md" initialFocus="input" className="sm:max-w-[560px]">
        <div className="-mx-4 -mt-3 border-b border-ds-line px-4 pb-3 pt-1 lg:-mx-5 lg:px-5">
          <div className="flex items-center gap-3">
            <Icon name="search" size={20} className="shrink-0 text-ds-muted" />
            <input
              type="search"
              role="combobox"
              aria-label="Search pages, posts, ideas and clips"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search pages, posts, ideas, clips"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ds-text outline-none placeholder:text-ds-muted [&::-webkit-search-cancel-button]:hidden"
            />
            <button type="button" onClick={close} className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-ds-sm px-2 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised focus-visible:outline-2 focus-visible:outline-ds-focus sm:hidden">
              Cancel
            </button>
            <kbd className="hidden shrink-0 rounded-ds-xs border border-ds-line px-1.5 py-0.5 font-[inherit] text-[11px] text-ds-muted sm:inline">Esc</kbd>
          </div>
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="-mx-2 max-h-[min(60vh,480px)] overflow-y-auto pt-2">
          {term.length < 2 ? (
            <p className="px-2 py-6 text-center text-[14px] text-ds-muted">Type at least two letters.</p>
          ) : data && data.groups.length === 0 && !loading ? (
            <p className="px-2 py-6 text-center text-[14px] text-ds-muted">Nothing matches &ldquo;{term}&rdquo;.</p>
          ) : (
            data?.groups.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`${listId}-g-${g.id}`} className="pb-2">
                <p id={`${listId}-g-${g.id}`} className="ds-label px-2 pb-1 pt-2 text-ds-muted">
                  {g.label}
                </p>
                {g.results.map((r) => {
                  idx += 1;
                  const i = idx;
                  return (
                    <div
                      key={r.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onPointerMove={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cx("flex min-h-11 cursor-pointer items-center gap-3 rounded-ds-sm px-2 py-1.5", i === active && "bg-ds-raised")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-ds-text">{r.title}</span>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-ds-muted">{r.meta}</span>
                      </span>
                      <Icon name="chevronRight" size={16} className={cx("shrink-0 text-ds-muted", i !== active && "opacity-0")} />
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {loading && !data ? <p className="px-2 py-6 text-center text-[14px] text-ds-muted">Searching…</p> : null}
        </div>
      </Dialog>
    </>
  );
}
