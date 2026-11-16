import { describe, expect, it } from "vitest";
import { CLOSE_DELAY_MS, createSidebarController, type Timers } from "../sidebar-timing.js";

/** Manual clock: timers fire only when advanced. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { timers, advance, pendingCount: () => pending.size };
}

function setup() {
  const t = fakeTimers();
  const changes: boolean[] = [];
  const c = createSidebarController((v) => changes.push(v), t.timers);
  return { c, changes, ...t };
}

describe("sidebar timing", () => {
  it("uses a 2.5 s close delay", () => {
    expect(CLOSE_DELAY_MS).toBe(2500);
  });

  it("opens on pointer enter", () => {
    const { c, changes } = setup();
    c.pointerEnter();
    expect(c.isOpen()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("closes 2500 ms after the pointer leaves, not before", () => {
    const { c, advance } = setup();
    c.pointerEnter();
    c.pointerLeave();
    advance(2499);
    expect(c.isOpen()).toBe(true);
    advance(1);
    expect(c.isOpen()).toBe(false);
  });

  it("re-entering cancels the pending close", () => {
    const { c, advance, pendingCount } = setup();
    c.pointerEnter();
    c.pointerLeave();
    advance(2000);
    c.pointerEnter();
    expect(pendingCount()).toBe(0);
    advance(5000);
    expect(c.isOpen()).toBe(true);
    c.pointerLeave();
    advance(2500);
    expect(c.isOpen()).toBe(false);
  });

  it("Esc closes immediately and drops the timer", () => {
    const { c, changes, pendingCount } = setup();
    c.pointerEnter();
    c.pointerLeave();
    c.escape();
    expect(c.isOpen()).toBe(false);
    expect(pendingCount()).toBe(0);
    expect(changes).toEqual([true, false]);
  });

  it("stays open while focus is inside, even after the pointer leaves", () => {
    const { c, advance } = setup();
    c.pointerEnter();
    c.focusIn();
    c.pointerLeave();
    advance(10_000);
    expect(c.isOpen()).toBe(true);
    c.focusOut();
    advance(2500);
    expect(c.isOpen()).toBe(false);
  });

  it("menu button toggles; toggle-close is immediate", () => {
    const { c, advance } = setup();
    c.toggle();
    expect(c.isOpen()).toBe(true);
    advance(10_000);
    expect(c.isOpen()).toBe(true); // opened by the button: no pointer left, so no timer
    c.toggle();
    expect(c.isOpen()).toBe(false);
  });

  it("reports each change once", () => {
    const { c, changes } = setup();
    c.pointerEnter();
    c.pointerEnter();
    c.focusIn();
    c.escape();
    c.escape();
    expect(changes).toEqual([true, false]);
  });
});
