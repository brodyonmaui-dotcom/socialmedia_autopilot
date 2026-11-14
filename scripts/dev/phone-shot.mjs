#!/usr/bin/env node
// Phone screenshot of a local page (iPhone 13 viewport) for checking UI work without a phone.
// Usage: node scripts/dev/phone-shot.mjs /app/library out.png [--port 3100] [--full] [--desktop] [--cookie name=value] [--theme dark] [--dark]
// --desktop uses a 1440×900 desktop viewport instead of the iPhone 13. --scale 2 for shots people will look at.
// Start the app first: cd apps/web && pnpm build && PORT=3100 DATABASE_URL=... pnpm start
// --cookie sets a cookie for localhost before loading (e.g. the ap_session printed by `pnpm dev:session`).
// Local URLs only. View the PNG with the Read tool; each image costs tokens, so take few.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const args = process.argv.slice(2);
const WITH_VALUE = new Set(["--port", "--cookie", "--scale", "--theme"]);
const positional = [];
const opts = {};
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (WITH_VALUE.has(a)) opts[a] = args[++k];
  else if (a.startsWith("--")) opts[a] = true;
  else positional.push(a);
}
const [path = "/app", out = "logs/phone.png"] = positional;
const port = opts["--port"] ?? "3100";

const browser = await chromium.launch();
const scale = Number(opts["--scale"] ?? 1);
const viewport = opts["--desktop"] === true
  ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale }
  : { ...devices["iPhone 13"], deviceScaleFactor: scale };
// --dark emulates prefers-color-scheme: dark (static pages under infra/static follow the OS theme).
const context = await browser.newContext({ ...viewport, ...(opts["--dark"] === true ? { colorScheme: "dark" } : {}) });
if (typeof opts["--cookie"] === "string") {
  const eq = opts["--cookie"].indexOf("=");
  if (eq < 1) throw new Error("--cookie expects name=value");
  await context.addCookies([{ name: opts["--cookie"].slice(0, eq), value: opts["--cookie"].slice(eq + 1), domain: "localhost", path: "/" }]);
}
// --theme dark|light sets the ds-theme cookie (Night/Day) for pages that read getTheme().
if (typeof opts["--theme"] === "string") {
  await context.addCookies([{ name: "ds-theme", value: opts["--theme"], domain: "localhost", path: "/" }]);
}
const page = await context.newPage();
const res = await page.goto(`http://localhost:${port}${path}`, { waitUntil: "networkidle" });
// Hide the Next.js dev-mode indicator so shots from `next dev` look like production.
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
await page.screenshot({ path: out, fullPage: opts["--full"] === true });
// Never print the cookie value.
console.log(`phone-shot: ${res?.status()} ${path} → ${out}`);
await browser.close();
