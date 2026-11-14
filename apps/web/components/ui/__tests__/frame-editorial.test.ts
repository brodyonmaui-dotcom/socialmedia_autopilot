import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../AppShell.js";
import { Display } from "../Display.js";
import { FooterBand } from "../FooterBand.js";
import { GridLines } from "../GridLines.js";
import { Marquee } from "../Marquee.js";
import { RevealList } from "../RevealList.js";
import { StatusBars } from "../StatusBars.js";
import { StatusPulse } from "../StatusPulse.js";
import { TabBar } from "../TabBar.js";
import { ThemeToggle } from "../ThemeToggle.js";

const count = (html: string, s: string) => html.split(s).length - 1;

describe("Display", () => {
  it("renders every line inside one h1 with the right style classes", () => {
    const html = renderToStaticMarkup(
      h(Display, { lines: [{ text: "WEEK 47", style: "stroke" }, { text: "approved", style: "serif" }, { text: "18/24" }] }),
    );
    expect(count(html, "<h1")).toBe(1);
    expect(html).toMatch(/^<h1 class="ds-display"/);
    for (const t of ["WEEK 47", "approved", "18/24"]) expect(html).toContain(t);
    expect(html).toContain("ds-stroke font-black");
    expect(html).toContain("ds-serif font-normal");
    expect(html).toContain("font-black ds-num");
  });
  it("can render as h2", () => {
    expect(renderToStaticMarkup(h(Display, { as: "h2", lines: [{ text: "x" }] }))).toMatch(/^<h2/);
  });
});

describe("Marquee", () => {
  const items = [{ text: "Instagram", style: "stroke" as const }, { text: "hooks", style: "serif" as const }];
  it("xl: renders items twice, the second copy aria-hidden, labelled", () => {
    const html = renderToStaticMarkup(h(Marquee, { items, label: "Instagram, hooks" }));
    expect(count(html, "Instagram<")).toBe(2);
    expect(html).toContain('aria-label="Instagram, hooks"');
    expect(html).toContain("animate-ds-marquee");
    const second = html.indexOf("Instagram<", html.indexOf("Instagram<") + 1);
    const before = html.slice(0, second);
    expect(before.lastIndexOf('aria-hidden="true" class="flex shrink-0')).toBeGreaterThan(before.indexOf("Instagram<"));
    expect(html.slice(0, html.indexOf("Instagram<"))).not.toContain('aria-hidden="true" class="flex shrink-0');
  });
  it("bg: entirely aria-hidden and non-interactive", () => {
    const html = renderToStaticMarkup(h(Marquee, { items, size: "bg", label: "ignored" }));
    expect(html).toMatch(/^<div aria-hidden="true" class="pointer-events-none select-none/);
    expect(html).not.toContain("ignored");
    expect(html).toContain("text-[20vw]");
  });
});

describe("StatusPulse", () => {
  it("defaults to the accent tone and never uses green", () => {
    const html = renderToStaticMarkup(h(StatusPulse, { label: "Autopilot on" }));
    expect(html).toContain("bg-ds-accent text-ds-accent");
    expect(html).toContain("animate-ds-pulse");
    expect(html).toContain("Autopilot on");
    expect(html).not.toMatch(/green/i);
  });
  it("footer status row has no green either", () => {
    const html = renderToStaticMarkup(
      h(FooterBand, { link: { href: "/inbox", label: "Inbox" }, status: "Worker operational", meta: "v0.1" }),
    );
    expect(html).not.toMatch(/green/i);
    expect(html).toContain("RUNMYSOCIALS");
  });
});

describe("RevealList", () => {
  const items = [
    { id: "a", index: "01", title: "Hook test", meta: "MON 18:00", href: "/post/a", image: { alt: "Hook test thumbnail" } },
    { id: "b", index: "02", title: "Behind the scenes", meta: "TUE 12:00", image: { src: "/t.jpg", alt: "BTS" } },
    { id: "c", index: "03", title: "No image", meta: "WED 09:00" },
  ];
  it("renders one li per item with a hidden clip-path reveal and an always-visible phone thumbnail", () => {
    const html = renderToStaticMarkup(h(RevealList, { items, label: "Up next" }));
    expect(html).toContain('aria-label="Up next"');
    expect((html.match(/<li[ >]/g) ?? []).length).toBe(3);
    expect(count(html, "[clip-path:inset(0_0_0_100%)]")).toBe(2);
    expect(count(html, "size-16 -translate-y-1/2 lg:hidden")).toBe(2);
    expect(html).toContain('href="/post/a"');
    expect(html).toContain("grayscale");
    expect(html).toContain("repeating-linear-gradient");
    // View circle only appears client-side on fine pointers.
    expect(html).not.toContain(">View<");
  });
});

describe("GridLines", () => {
  it("renders 12 columns with 8 hidden below lg", () => {
    const html = renderToStaticMarkup(h(GridLines));
    expect(html).toMatch(/^<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0"/);
    expect(count(html, "border-l border-ds-grid")).toBe(12);
    expect(count(html, "hidden lg:block")).toBe(8);
  });
});

describe("frame", () => {
  const nav = [
    { id: "home", label: "Home", href: "/", icon: "home" as const },
    { id: "batches", label: "Batches", href: "/batches", icon: "batches" as const, badge: 3 },
  ];
  it("AppShell defaults to Day and renders header, main and tab bar", () => {
    const html = renderToStaticMarkup(h(AppShell, { nav, active: "home", cta: { href: "/new", label: "New batch" }, children: "hi" }));
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('<main id="main"');
    expect(html).toContain("MYSOCIALS");
    expect(html).toContain('aria-label="New batch"');
    expect(html).toContain('aria-label="Switch to night theme"');
  });
  it("TabBar marks the active item", () => {
    const html = renderToStaticMarkup(h(TabBar, { nav, active: "batches" }));
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(html).toContain("bg-ds-accent");
  });
  it("ThemeToggle labels the target theme", () => {
    expect(renderToStaticMarkup(h(ThemeToggle, { initial: "dark" }))).toContain('aria-label="Switch to day theme"');
  });
  it("StatusBars exposes meters", () => {
    const html = renderToStaticMarkup(h(StatusBars, { rows: [{ label: "IG", value: 140 }] }));
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="100"');
  });
});
