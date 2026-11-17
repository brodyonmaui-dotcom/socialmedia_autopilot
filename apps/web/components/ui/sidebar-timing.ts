// Pure open/close timing for the desktop Sidebar (no DOM, no React). Tested in __tests__/sidebar-timing.test.ts.
//
// Rules (ui-system.md "Shell"): the hot zone or the panel opens it on pointer enter; it stays open while
// the pointer or keyboard focus is inside; it closes CLOSE_DELAY_MS after the pointer leaves (re-entry
// cancels the timer); Esc closes at once. The menu button toggles it.

export const CLOSE_DELAY_MS = 2500;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SidebarController {
  readonly isOpen: () => boolean;
  /** Pointer entered the hot zone or the panel. */
  pointerEnter(): void;
  /** Pointer left the panel (or the hot zone without reaching the panel). */
  pointerLeave(): void;
  /** Focus moved into the panel. */
  focusIn(): void;
  /** Focus left the panel (to somewhere outside it). */
  focusOut(): void;
  /** Esc: close now. */
  escape(): void;
  /** Menu button. */
  toggle(): void;
  open(): void;
  close(): void;
  /** Cancel any pending timer (unmount). */
  dispose(): void;
}

export function createSidebarController(onChange: (open: boolean) => void, timers: Timers = realTimers, delay = CLOSE_DELAY_MS): SidebarController {
  let open = false;
  let pointerInside = false;
  let focusInside = false;
  let timer: unknown = null;

  const cancel = () => {
    if (timer != null) timers.clear(timer);
    timer = null;
  };
  const set = (v: boolean) => {
    if (v === open) return;
    open = v;
    onChange(v);
  };
  const closeNow = () => {
    cancel();
    pointerInside = false;
    focusInside = false;
    set(false);
  };
  const scheduleClose = () => {
    cancel();
    if (!open || pointerInside || focusInside) return;
    timer = timers.set(() => {
      timer = null;
      if (!pointerInside && !focusInside) set(false);
    }, delay);
  };

  return {
    isOpen: () => open,
    pointerEnter() {
      pointerInside = true;
      cancel();
      set(true);
    },
    pointerLeave() {
      pointerInside = false;
      scheduleClose();
    },
    focusIn() {
      focusInside = true;
      cancel();
      set(true);
    },
    focusOut() {
      focusInside = false;
      scheduleClose();
    },
    escape: closeNow,
    toggle() {
      if (open) closeNow();
      else {
        cancel();
        set(true);
      }
    },
    open() {
      cancel();
      set(true);
    },
    close: closeNow,
    dispose: cancel,
  };
}
