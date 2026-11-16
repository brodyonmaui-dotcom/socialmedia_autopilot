import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Display } from "../Display.js";
import { FooterBand } from "../FooterBand.js";
import { GridLines } from "../GridLines.js";
import { IconButton, badgeText, labelWithCount } from "../IconButton.js";
import { Marquee } from "../Marquee.js";
import { NoiseOverlay } from "../NoiseOverlay.js";
import { NotificationsPopover } from "../NotificationsPopover.js";
import { PageHeader, Wordmark } from "../PageHeader.js";
import { SectionHead } from "../SectionHead.js";
import { MenuButton, Sidebar, SidebarProvider } from "../Sidebar.js";
import { StatusPulse } from "../StatusPulse.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { TopBar } from "../TopBar.js";
import { sidebarNav } from "../../app-nav.js";

const count = (html: string, s: string) => html.split(s).length - 1;
const noop = async () => {};

describe("v2 decoration is gone (hard rules 2 and 3)", () => {
  it("GridLines, NoiseOverlay, Marquee and FooterBand render nothing", () => {
    expect(renderToStaticMarkup(h(GridLines))).toBe("");
    expect(renderToStaticMarkup(h(NoiseOverlay))).toBe("");
    expect(renderToStaticMarkup(h(Marquee, { items: [{ text: "Instagram" }], label: "x" }))).toBe("");
    expect(renderToStaticMarkup(h(FooterBand, { link: { href: "/", label: "Home" }, status: "s", meta: "m" }))).toBe("");
  });
  it("StatusPulse is a static dot (no animation), never green", () => {
    const html = renderToStaticMarkup(h(StatusPulse, { label: "On" }));
    expect(html).not.toContain("animate");
    expect(html).toContain("bg-ds-accent");
    expect(html).not.toMatch(/green/i);
  });
  it("Display, SectionHead and TopBar put the whole phrase in one font (no serif word, no outline, no index)", () => {
    const d = renderToStaticMarkup(h(Display, { lines: [{ text: "Week 47", style: "stroke" }, { text: "approved", style: "serif" }] }));
    expect(d).toBe('<h1 class="ds-title text-ds-text">Week 47 approved</h1>');
    const s = renderToStaticMarkup(h(SectionHead, { index: "02", title: "Up", serif: "next" }));
    expect(s).toContain(">Up next<");
    expect(s).not.toContain("02");
    const t = renderToStaticMarkup(h(TopBar, { index: "02", title: "Weekly", serif: "batches", meta: "3 weeks" }));
    expect(t).toContain('<h1 class="ds-title text-ds-text">Weekly batches</h1>');
    expect(t).not.toContain("02 /");
  });
});

describe("PageHeader / Wordmark", () => {
  it("display title, sans subtitle, right slot", () => {
    const html = renderToStaticMarkup(h(PageHeader, { title: "Home", subtitle: "Nov 16 – 22", action: h("button", null, "This week") }));
    expect(html).toContain('<h1 class="ds-title text-ds-text">Home</h1>');
    expect(html).toContain("Nov 16 – 22");
    expect(html).toContain(">This week<");
  });
  it("the logo is 'My Socials' in the display face", () => {
    const html = renderToStaticMarkup(h(Wordmark));
    expect(html).toContain("ds-font-display");
    expect(html).toContain(">My Socials<");
  });
});

describe("IconButton", () => {
  it("is a labelled 40px hairline square with a count badge in its name", () => {
    const html = renderToStaticMarkup(h(IconButton, { icon: "inbox", label: "Inbox", badge: 3, badgeNoun: "waiting" }));
    expect(html).toContain('aria-label="Inbox, 3 waiting"');
    expect(html).toContain("lg:size-10");
    expect(html).toContain("rounded-ds-sm");
    expect(html).toContain("border border-ds-line");
    expect(html).toContain(">3<");
  });
  it("badge text caps at 99+ and hides zero", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");
    expect(labelWithCount("Notifications", 0)).toBe("Notifications");
  });
  it("ThemeToggle uses the same icon button and labels the target theme", () => {
    const html = renderToStaticMarkup(h(ThemeToggle, { initial: "dark" }));
    expect(html).toContain('aria-label="Switch to day theme"');
    expect(html).toContain("rounded-ds-sm");
  });
});

describe("Sidebar (server markup)", () => {
  const nav = sidebarNav({ flagged: 2 });
  const render = (currentHref: string, openGroups: string[]) =>
    renderToStaticMarkup(
      h(SidebarProvider, null, h(MenuButton), h(Sidebar, { nav, currentHref, openGroups, logoutAction: noop })),
    );

  it("is a real nav, closed (inert) by default, with a labelled menu button", () => {
    const html = render("/", []);
    expect(html).toContain('<nav aria-label="Main"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="app-sidebar"');
    expect(html).toContain("inert");
    expect(html).toContain("-translate-x-[calc(100%_+_48px)]");
    expect(html).toContain(">Log out<");
    expect(html).toContain(">My Socials<");
  });

  it("marks exactly one link as the current page and opens its group", () => {
    const html = render("/analytics/youtube", ["analytics"]);
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*href="[^"]*\/analytics\/youtube"/);
    // Analytics group open, Library group closed.
    expect(html).toMatch(/aria-expanded="true"[^>]*>.*?Analytics/);
    expect(count(html, 'aria-expanded="false"')).toBe(1 + 2); // menu button + Library + Platforms
  });

  it("shows the inbox count", () => {
    expect(render("/", [])).toContain(">2<");
  });
});

describe("NotificationsPopover (closed)", () => {
  it("is a bell button with the open count and a dialog popup", () => {
    const html = renderToStaticMarkup(h(NotificationsPopover, { items: [], openCount: 2, ackAction: noop }));
    expect(html).toContain('aria-label="Notifications, 2 open"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });
});
