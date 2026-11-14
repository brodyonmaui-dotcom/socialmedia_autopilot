import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthCalendar } from "../MonthCalendar.js";
import { PlatformLogo, type Platform } from "../PlatformLogo.js";
import { otherTheme, parseTheme, themeCookie } from "../theme.js";

describe("theme helpers", () => {
  it("defaults to light (Day) for anything but an explicit dark", () => {
    expect(parseTheme("dark")).toBe("dark");
    for (const v of ["light", "", undefined, null, "DARK", "system"]) expect(parseTheme(v)).toBe("light");
  });
  it("flips and writes a year-long app-wide cookie", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
    expect(themeCookie("light")).toBe("ds-theme=light; path=/; max-age=31536000; samesite=lax");
  });
});

describe("PlatformLogo", () => {
  const all: Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];
  it("renders every platform in currentColor only (no brand colours) and decorative by default", () => {
    for (const p of all) {
      const html = renderToStaticMarkup(createElement(PlatformLogo, { platform: p }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(html).toMatch(/currentColor/);
    }
  });
  it("is labelled when given a title", () => {
    const html = renderToStaticMarkup(createElement(PlatformLogo, { platform: "tiktok", title: "TikTok" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="TikTok"');
  });
});

describe("MonthCalendar weekStartsOn", () => {
  const headers = (html: string) => [...html.matchAll(/abbr="(\w+)"/g)].map((m) => m[1]);
  it("is Monday-first by default and Sunday-first on request", () => {
    const mon = renderToStaticMarkup(createElement(MonthCalendar, { year: 2026, month0: 10 }));
    const sun = renderToStaticMarkup(createElement(MonthCalendar, { year: 2026, month0: 10, weekStartsOn: 0 }));
    expect(headers(mon)[0]).toBe("Monday");
    expect(headers(sun)[0]).toBe("Sunday");
    expect(headers(sun)[6]).toBe("Saturday");
  });
});
