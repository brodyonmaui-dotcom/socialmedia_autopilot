import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "../Badge.js";
import { Checkbox } from "../Checkbox.js";
import { ProgressBar } from "../ProgressBar.js";

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
