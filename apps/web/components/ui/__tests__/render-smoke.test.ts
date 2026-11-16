import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertCard } from "../AlertCard.js";
import { Badge, Chip } from "../Badge.js";
import { Button } from "../Button.js";
import { Card, CardGrid } from "../Card.js";
import { Checkbox } from "../Checkbox.js";
import { Donut } from "../Donut.js";
import { EmptyState } from "../EmptyState.js";
import { Input } from "../Input.js";
import { ListRow, ListRows } from "../ListRow.js";
import { MonthCalendar } from "../MonthCalendar.js";
import { PageDots } from "../PageDots.js";
import { ProgressBar } from "../ProgressBar.js";
import { AreaChart, MiniBars } from "../Sparkline.js";
import { StatTile } from "../StatTile.js";
import { Stepper } from "../Stepper.js";
import { TabLinks, Tabs } from "../Tabs.js";
import { Toggle } from "../Toggle.js";
import { Tooltip } from "../Tooltip.js";

describe("ui render smoke (server markup)", () => {
  it("Badge warn shows text plus an alert icon", () => {
    const html = renderToStaticMarkup(h(Badge, { tone: "warn", children: "Needs fix" }));
    expect(html).toContain("Needs fix");
    expect(html).toContain("<svg");
    expect(html).toContain("text-ds-warn");
  });

  it("Badge neutral has no icon", () => {
    expect(renderToStaticMarkup(h(Badge, { children: "Draft" }))).not.toContain("<svg");
  });

  it("ProgressBar exposes progressbar values", () => {
    const html = renderToStaticMarkup(h(ProgressBar, { value: 3, max: 8, label: "Approved" }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuemax="8"');
    expect(html).toContain('aria-valuetext="3/8"');
    expect(html).toContain("width:37.5%");
  });

  it("Checkbox is a real labelled input with pass-through props", () => {
    const html = renderToStaticMarkup(h(Checkbox, { label: "Instagram", name: "platforms", value: "ig", defaultChecked: true }));
    expect(html).toMatch(/^<label/);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="platforms"');
    expect(html).toContain('value="ig"');
    expect(html).toContain("checked");
    expect(html).toContain("Instagram");
  });
});

describe("ui render smoke · v3 Quiet dashboard", () => {
  it("Badge tones: soft neutral pill, solid invert, sentence-case 12px", () => {
    const n = renderToStaticMarkup(h(Badge, { children: "Draft" }));
    expect(n).toContain("rounded-full");
    expect(n).toContain("bg-ds-raised");
    expect(n).toContain("text-[12px] font-semibold");
    expect(n).not.toContain("uppercase");
    expect(renderToStaticMarkup(h(Badge, { tone: "solid", children: "Live" }))).toContain("bg-ds-invert");
    expect(renderToStaticMarkup(h(Badge, { tone: "danger", children: "Missing" }))).toContain("<svg");
  });

  it("Chip is an 8px-radius hairline tag", () => {
    const html = renderToStaticMarkup(h(Chip, { children: "#tag" }));
    expect(html).toContain("border-ds-line");
    expect(html).toContain("rounded-ds-sm");
  });

  it("Button arrow is a static trailing svg (nothing rotates)", () => {
    const html = renderToStaticMarkup(h(Button, { arrow: true, children: "Open" }));
    expect(html).toContain("Open");
    expect(html).toContain("<svg");
    expect(html).not.toContain("rotate");
    expect(renderToStaticMarkup(h(Button, { children: "Plain" }))).not.toContain("<svg");
  });

  it("Card: filled, 12px radius, hairline, display title, no index label", () => {
    const html = renderToStaticMarkup(h(Card, { title: "Activity", index: "01", action: { href: "/x", label: "See all" }, children: "x" }));
    expect(html).toContain("rounded-ds-lg");
    expect(html).toContain("border-ds-line");
    expect(html).toContain("bg-ds-card");
    expect(html).toContain("h-full");
    expect(html).toMatch(/<h2[^>]*class="ds-heading[^"]*"[^>]*>Activity</);
    expect(html).not.toContain(">01<");
    expect(html).toContain(">See all<");
    expect(html).not.toContain("shadow");
  });

  it("CardGrid has gaps (cards never share borders)", () => {
    const html = renderToStaticMarkup(h(CardGrid, { children: h(Card, { title: "A" }) }));
    expect(html).toContain("gap-3");
    expect(html).not.toContain("-ml-px");
  });

  it("StatTile: Inter 700 tabular number, '–' for unknown with its reason, accent delta when up, tint", () => {
    const html = renderToStaticMarkup(h(StatTile, { icon: "eye", label: "Views", value: "1,234", delta: { text: "▲ 12% vs last week", tone: "up" }, tint: 1 }));
    expect(html).toContain("ds-num text-[28px] font-bold");
    expect(html).toContain("lg:text-[32px]");
    expect(html).toContain("bg-ds-tint-1");
    expect(html).toContain("text-ds-accent-fg");
    expect(html).not.toContain("font-black");
    const none = renderToStaticMarkup(h(StatTile, { icon: "users", label: "Followers", value: null, note: "Collected after the next sync" }));
    expect(none).toContain(">–<");
    expect(none).toContain("Collected after the next sync");
    const down = renderToStaticMarkup(h(StatTile, { icon: "eye", label: "Views", value: 3, delta: { text: "▼ 4% vs last week", tone: "down" } }));
    expect(down).toContain("text-ds-muted");
    expect(down).not.toContain("text-ds-accent-fg");
  });

  it("ListRow monogram avatar is round", () => {
    const html = renderToStaticMarkup(h(ListRows, { children: h(ListRow, { avatar: { monogram: "AB" }, title: "Ana", subtitle: "2h", trailing: "12" }) }));
    expect(html).toContain("AB");
    expect(html).toContain("rounded-full");
  });

  it("TabLinks: segmented control, active segment raised, aria-current kept", () => {
    const html = renderToStaticMarkup(
      h(TabLinks, {
        ariaLabel: "Inbox",
        items: [
          { href: "/a", label: "Comments", active: true, count: 3 },
          { href: "/b", label: "DMs", active: false },
        ],
      }),
    );
    expect(html).toContain("rounded-ds-sm border border-ds-line bg-ds-card");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("bg-ds-raised text-ds-text");
    expect(html).not.toContain("bg-ds-invert");
  });

  it("Tabs (client) keep role=tab and aria-selected", () => {
    const html = renderToStaticMarkup(h(Tabs, { ariaLabel: "View", items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("bg-ds-raised");
  });

  it("Input: bordered 8px field, label, helper, error wiring", () => {
    const html = renderToStaticMarkup(h(Input, { label: "Caption", name: "c", helper: "Max 2200", error: "Too long" }));
    expect(html).toContain("rounded-ds-sm border border-ds-line-strong");
    expect(html).toContain("focus:border-ds-accent");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("border-b-2");
  });

  it("Toggle keeps role=switch with a 48x28 pill track", () => {
    const html = renderToStaticMarkup(h(Toggle, { label: "Auto-reply", defaultChecked: true, variant: "text" }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("h-7 w-12 rounded-full");
    expect(html).toContain("On");
  });

  it("ProgressBar is a round-ended accent bar", () => {
    const html = renderToStaticMarkup(h(ProgressBar, { value: 1, max: 2, label: "Posted", showLabel: true }));
    expect(html).toContain("rounded-full bg-ds-accent");
  });

  it("MiniBars / AreaChart have no gradients", () => {
    const bars = renderToStaticMarkup(h(MiniBars, { values: [1, 2, 3], highlightIndex: 2, label: "Posts" }));
    expect(bars).toContain("fill-ds-line-strong/40");
    const area = renderToStaticMarkup(h(AreaChart, { values: [1, 3, 2], label: "Views" }));
    expect(area).not.toContain("linearGradient");
  });

  it("Donut and MonthCalendar render; today is marked", () => {
    expect(renderToStaticMarkup(h(Donut, { label: "Split", segments: [{ label: "IG", value: 2, tone: "accent" }] }))).toContain("IG");
    const cal = renderToStaticMarkup(h(MonthCalendar, { year: 2026, month0: 10, today: 13, marks: { 13: ["accent"] } }));
    expect(cal).toContain("border-ds-text");
    expect(cal).toContain('aria-current="date"');
  });

  it("Tooltip/EmptyState/AlertCard/PageDots/Stepper render v3 classes", () => {
    const tt = renderToStaticMarkup(h(Tooltip, { id: "t", text: "Hint", children: "x" }));
    expect(tt).toContain("rounded-ds-sm bg-ds-invert");
    const es = renderToStaticMarkup(h(EmptyState, { icon: "inbox", title: "Nothing yet" }));
    expect(es).toContain("ds-heading");
    const ac = renderToStaticMarkup(h(AlertCard, { title: "Attention", children: "Body" }));
    expect(ac).toContain("rounded-ds-lg");
    expect(ac).toContain("text-ds-warn");
    expect(renderToStaticMarkup(h(PageDots, { count: 3, active: 1, label: "Pages" }))).toContain("w-6 bg-ds-text");
    const st = renderToStaticMarkup(h(Stepper, { label: "Posts", defaultValue: 2 }));
    expect(st).toContain("rounded-ds-sm");
  });
});
