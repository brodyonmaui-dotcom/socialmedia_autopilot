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

describe("ui render smoke · v2 Warm Industrial", () => {
  it("Badge tones: neutral line, solid invert, caps", () => {
    const n = renderToStaticMarkup(h(Badge, { children: "Draft" }));
    expect(n).toContain("border-ds-line-strong");
    expect(n).toContain("ds-caps");
    expect(renderToStaticMarkup(h(Badge, { tone: "solid", children: "Live" }))).toContain("bg-ds-invert");
    expect(renderToStaticMarkup(h(Badge, { tone: "danger", children: "Missing" }))).toContain("<svg");
  });

  it("Chip is sharp with a 1px line", () => {
    const html = renderToStaticMarkup(h(Chip, { children: "#tag" }));
    expect(html).toContain("border-ds-line");
    expect(html).toContain("bg-ds-card");
    expect(html).not.toContain("rounded");
  });

  it("Button arrow renders a rotating trailing svg inside a hover group", () => {
    const html = renderToStaticMarkup(h(Button, { arrow: true, children: "Review batch" }));
    expect(html).toContain("Review batch");
    expect(html).toMatch(/class="[^"]*\bgroup\b/);
    expect(html).toContain("-rotate-45");
    expect(html).toContain("group-hover:rotate-0");
    expect(html).toContain("duration-[600ms]");
    expect(renderToStaticMarkup(h(Button, { children: "Plain" }))).not.toContain("<svg");
  });

  it("Card is a bordered transparent cell with caps title and mono index; fill + hero invert", () => {
    const html = renderToStaticMarkup(h(Card, { title: "Up next", index: "01", children: "x" }));
    expect(html).toContain("border-ds-line");
    expect(html).toContain("bg-transparent");
    expect(html).toContain("ds-caps");
    expect(html).toMatch(/ds-mono[^>]*>01</);
    const filled = renderToStaticMarkup(h(Card, { fill: true, hero: "Hero", children: "x" }));
    expect(filled).toContain("bg-ds-card");
    expect(filled).toContain("bg-ds-invert");
  });

  it("CardGrid is gap-0 with collapsed borders", () => {
    const html = renderToStaticMarkup(h(CardGrid, { children: h(Card, { title: "A" }) }));
    expect(html).toContain("gap-0");
    expect(html).toContain("[&amp;&gt;*]:-ml-px");
    expect(html).toContain("xl:grid-cols-3");
  });

  it("StatTile has no circle and a 40px black number", () => {
    const html = renderToStaticMarkup(h(StatTile, { icon: "eye", value: 1234, caption: "Views" }));
    expect(html).toContain("text-[40px]");
    expect(html).toContain("font-black");
    expect(html).toContain("ds-caps");
    expect(html).not.toContain("rounded");
  });

  it("ListRow monogram avatar is a bordered square", () => {
    const html = renderToStaticMarkup(
      h(ListRows, { children: h(ListRow, { avatar: { monogram: "AB" }, title: "Ana", subtitle: "2h", trailing: "12" }) }),
    );
    expect(html).toContain("AB");
    expect(html).toContain("border-ds-line");
    expect(html).toContain("ds-mono");
    expect(html).not.toContain("rounded");
  });

  it("TabLinks: bordered strip, active cell inverted, aria-current kept", () => {
    const html = renderToStaticMarkup(
      h(TabLinks, {
        ariaLabel: "Inbox",
        items: [
          { href: "/a", label: "Comments", active: true, count: 3 },
          { href: "/b", label: "DMs", active: false },
        ],
      }),
    );
    expect(html).toContain("border-ds-text");
    expect(html).toContain("divide-ds-text");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("bg-ds-invert");
  });

  it("Tabs (client) keep role=tab and aria-selected", () => {
    const html = renderToStaticMarkup(h(Tabs, { ariaLabel: "View", items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("bg-ds-invert");
  });

  it("Input: underline field, caps label, mono helper, error wiring", () => {
    const html = renderToStaticMarkup(h(Input, { label: "Caption", name: "c", helper: "Max 2200", error: "Too long" }));
    expect(html).toContain("border-b-2");
    expect(html).toContain("focus:border-ds-accent");
    expect(html).toContain("ds-mono");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("rounded");
  });

  it("Toggle keeps role=switch with a 48x28 pill track", () => {
    const html = renderToStaticMarkup(h(Toggle, { label: "Auto-reply", defaultChecked: true, variant: "text" }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("h-7 w-12 rounded-full");
    expect(html).toContain("On");
  });

  it("ProgressBar is a 4px square-ended accent bar", () => {
    const html = renderToStaticMarkup(h(ProgressBar, { value: 1, max: 2, label: "Posted", showLabel: true }));
    expect(html).toContain("h-1 ");
    expect(html).toContain("bg-ds-accent");
    expect(html).not.toContain("rounded");
  });

  it("MiniBars are sharp rects; AreaChart fill is flat (no gradient) with a square marker", () => {
    const bars = renderToStaticMarkup(h(MiniBars, { values: [1, 2, 3], highlightIndex: 2, label: "Posts" }));
    expect(bars).not.toContain("rx=");
    expect(bars).toContain("fill-ds-line-strong/40");
    const area = renderToStaticMarkup(h(AreaChart, { values: [1, 3, 2], label: "Views" }));
    expect(area).not.toContain("linearGradient");
    expect(area).toContain('fill-opacity="0.08"');
    expect(area).toContain('stroke-width="1.5"');
    expect(area).toContain("size-1.5");
    expect(area).not.toContain("rounded");
  });

  it("Donut legend squares; MonthCalendar square today marker", () => {
    const d = renderToStaticMarkup(h(Donut, { label: "Split", segments: [{ label: "IG", value: 2, tone: "accent" }] }));
    expect(d).not.toContain("rounded");
    const cal = renderToStaticMarkup(h(MonthCalendar, { year: 2026, month0: 10, today: 13, marks: { 13: ["accent"] } }));
    expect(cal).toContain("border-ds-text");
    expect(cal).toContain('aria-current="date"');
    expect(cal).not.toContain("rounded");
  });

  it("Sheet/Tooltip/EmptyState/AlertCard/PageDots/Stepper render v2 classes", () => {
    const tt = renderToStaticMarkup(h(Tooltip, { id: "t", text: "Hint", children: "x" }));
    expect(tt).toContain("bg-ds-invert");
    expect(tt).toContain("ds-mono");
    const es = renderToStaticMarkup(h(EmptyState, { icon: "inbox", title: "Nothing yet" }));
    expect(es).toContain("border-ds-line");
    expect(es).not.toContain("rounded");
    const ac = renderToStaticMarkup(h(AlertCard, { title: "Attention", children: "Body" }));
    expect(ac).toContain("bg-ds-invert");
    expect(ac).toContain("ds-caps");
    expect(renderToStaticMarkup(h(AlertCard, { tone: "light", title: "A" }))).toContain("bg-ds-card");
    const pd = renderToStaticMarkup(h(PageDots, { count: 3, active: 1, label: "Pages" }));
    expect(pd).toContain("w-6 bg-ds-text");
    expect(pd).not.toContain("rounded");
    const st = renderToStaticMarkup(h(Stepper, { label: "Posts", defaultValue: 2 }));
    expect(st).toContain("divide-x");
    expect(st).not.toContain("rounded");
  });
});
