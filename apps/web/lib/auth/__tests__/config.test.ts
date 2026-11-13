import { describe, expect, it } from "vitest";
import { authConfigFromEnv } from "../config.js";

describe("authConfigFromEnv", () => {
  it("DOMAIN → https origin, secure cookie", () => {
    expect(authConfigFromEnv({ DOMAIN: "dash.example.com", NODE_ENV: "production" })).toEqual({
      rpID: "dash.example.com",
      origin: "https://dash.example.com",
      rpName: "runmysocials",
      secureCookie: true,
    });
  });
  it("dev → localhost", () => {
    expect(authConfigFromEnv({ NODE_ENV: "development" })).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3100",
      rpName: "runmysocials",
      secureCookie: false,
    });
    expect(authConfigFromEnv({ WEB_ORIGIN: "http://localhost:3000" }).origin).toBe("http://localhost:3000");
  });
  it("production without DOMAIN throws", () => {
    expect(() => authConfigFromEnv({ NODE_ENV: "production" })).toThrow(/DOMAIN/);
  });
});
