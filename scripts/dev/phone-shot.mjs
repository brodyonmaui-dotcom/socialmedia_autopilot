#!/usr/bin/env node
// Phone screenshot of a local page (iPhone 13 viewport) for checking UI work without a phone.
// Usage: node scripts/dev/phone-shot.mjs /app/library out.png [--port 3100] [--full]
// Start the app first: cd apps/web && pnpm build && PORT=3100 DATABASE_URL=... pnpm start
// Local URLs only. View the PNG with the Read tool; each image costs tokens, so take few.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const [path = "/app", out = "logs/phone.png"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const i = process.argv.indexOf("--port");
const port = i > 0 ? process.argv[i + 1] : "3100";
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["iPhone 13"], deviceScaleFactor: 1 });
const res = await page.goto(`http://localhost:${port}${path}`, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: process.argv.includes("--full") });
console.log(`phone-shot: ${res?.status()} ${path} → ${out}`);
await browser.close();
