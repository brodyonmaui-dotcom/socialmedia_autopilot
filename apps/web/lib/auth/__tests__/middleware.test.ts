import { describe, expect, it } from "vitest";
import { config } from "../../../middleware.js";
import { middlewareDecision, MW_SESSION_COOKIE } from "../middleware-logic.js";
import { isWellFormedToken, newSessionToken, SESSION_COOKIE } from "../session.js";

describe("middlewareDecision", () => {
  const good = newSessionToken().token;
  it("no cookie → redirect", () => expect(middlewareDecision("/library", undefined)).toBe("redirect"));
  it("malformed → redirect", () => {
    for (const bad of ["", "x", good.slice(1), good + "A", "+" + good.slice(1), "=" + good.slice(1)]) {
      expect(middlewareDecision("/library", bad)).toBe("redirect");
    }
  });
  it("well-formed → pass", () => {
    expect(middlewareDecision("/library", good)).toBe("pass");
    expect(middlewareDecision("/", good)).toBe("pass");
  });
  it("public paths pass without a cookie", () => {
    for (const p of ["/login", "/_next/static/x", "/_next/image", "/manifest.json", "/sw.js", "/favicon.ico", "/icons/a.png"]) {
      expect(middlewareDecision(p, undefined)).toBe("pass");
    }
    expect(middlewareDecision("/loginx", undefined)).toBe("redirect");
    expect(middlewareDecision("/", undefined)).toBe("redirect");
  });
  it("agrees with session.ts", () => {
    expect(MW_SESSION_COOKIE).toBe(SESSION_COOKIE);
    for (const t of [good, "", "x".repeat(43), "+".repeat(43), "x".repeat(44)]) {
      expect(middlewareDecision("/x", t) === "pass").toBe(isWellFormedToken(t));
    }
  });
  it("matcher excludes login and static assets", () => {
    const re = new RegExp(`^${config.matcher[1]!}$`);
    expect(config.matcher[0]).toBe("/");
    for (const p of ["/login", "/_next/static/x.js", "/_next/image", "/manifest.json", "/sw.js", "/favicon.ico", "/icons/a.png"]) {
      expect(re.test(p), p).toBe(false);
    }
    for (const p of ["/", "/library", "/research/ideas", "/alerts"]) expect(re.test(p), p).toBe(true);
    expect(middlewareDecision("/alerts", undefined)).toBe("redirect");
    expect(middlewareDecision("/sw.js", undefined)).toBe("pass");
  });
});
