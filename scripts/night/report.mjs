#!/usr/bin/env node
// Morning report: night log JSON + session token usage + week tracker → one self-contained grayscale HTML page.
// Usage: node scripts/night/report.mjs --log docs/night-logs/2026-11-12.json [--since 2026-11-12T03:00:00Z] [--out file.html]
// Prints one summary line. Reads only Claude Code transcripts (token counts), never .env or secrets.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const logPath = arg("log");
if (!logPath || !existsSync(logPath)) { console.log("report: FAIL missing --log <night-log.json>"); process.exit(1); }
const log = JSON.parse(readFileSync(logPath, "utf8"));
const trackerPath = "docs/fable-week.json";
const tracker = existsSync(trackerPath) ? JSON.parse(readFileSync(trackerPath, "utf8")) : { items: [] };
const since = Date.parse(arg("since") ?? log.startedAt ?? 0) || 0;
const until = Date.parse(log.endedAt ?? "") || Date.now();

// ---- token usage from transcripts (deduped by message id) ----
const PRICES = { // USD per million tokens, API list prices, for a relative "API-equivalent" figure only
  "claude-fable-5-1": { in: 10, out: 50, cr: 0.25, cw: 12.5 },
  "claude-opus-5-5": { in: 4, out: 20, cr: 0.2, cw: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cr: 0.2, cw: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cr: 0.01, cw: 0.125 },
};
const projRoot = join(homedir(), ".claude", "projects");
const files = [];
if (existsSync(projRoot)) {
  for (const d of readdirSync(projRoot)) {
    if (!/socialmedia/i.test(d)) continue;
    // Recursive: subagent transcripts (implementer/scout) live in <session>/subagents/*.jsonl, not at the top level.
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (f.endsWith(".jsonl") && st.mtimeMs >= since) files.push(p);
      }
    };
    walk(join(projRoot, d));
  }
}
const seen = new Set();
const byModel = {};
let first = Infinity, last = 0;
for (const f of files) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const m = e.message; const u = m?.usage; const t = Date.parse(e.timestamp ?? "");
    if (!u || !m?.model || (t && (t < since || t > until))) continue;
    const id = m.id ?? `${f}:${e.uuid}`;
    if (seen.has(id)) continue; seen.add(id);
    const b = (byModel[m.model] ??= { in: 0, out: 0, cr: 0, cw: 0, calls: 0 });
    b.in += u.input_tokens ?? 0; b.out += u.output_tokens ?? 0;
    b.cr += u.cache_read_input_tokens ?? 0; b.cw += u.cache_creation_input_tokens ?? 0; b.calls++;
    if (t) { first = Math.min(first, t); last = Math.max(last, t); }
  }
}
const tot = Object.values(byModel).reduce((a, b) => ({ in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw, calls: a.calls + b.calls }), { in: 0, out: 0, cr: 0, cw: 0, calls: 0 });
const cost = Object.entries(byModel).reduce((s, [mod, b]) => { const p = PRICES[mod] ?? PRICES["claude-opus-5-5"]; return s + (b.in * p.in + b.out * p.out + b.cr * p.cr + b.cw * p.cw) / 1e6; }, 0);
const costOf = (mod, b) => { const p = PRICES[mod] ?? PRICES["claude-opus-5-5"]; return (b.in * p.in + b.out * p.out + b.cr * p.cr + b.cw * p.cw) / 1e6; };
const leadCost = Object.entries(byModel).filter(([m]) => /fable/.test(m)).reduce((s, [m, b]) => s + costOf(m, b), 0);
const leadShare = cost ? Math.round((100 * leadCost) / cost) : 0;
const hours = first < Infinity ? (last - first) / 36e5 : 0;

// ---- render ----
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const list = (arr, empty = "Nothing.") => (arr?.length ? `<ul>${arr.map((x) => `<li>${typeof x === "string" ? esc(x) : `<b>${esc(x.title)}</b>${x.detail ? `<span class="d">${esc(x.detail)}</span>` : ""}`}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`);
const statusOf = { done: "Done", "in-progress": "In progress", todo: "To do", blocked: "Blocked" };
const items = tracker.items ?? [];
const doneCount = items.filter((i) => i.status === "done").length;
const attn = [...(log.needsAttention ?? [])].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Night report ${esc(log.date)}</title>
<style>
:root{--bg:#fafafa;--card:#fff;--fg:#111;--mute:#6b6b6b;--line:#e4e4e4;--chip:#f0f0f0;--strong:#000}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e0e;--card:#171717;--fg:#ededed;--mute:#9a9a9a;--line:#2a2a2a;--chip:#222;--strong:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
header h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}header p{margin:0;color:var(--mute)}
.pill{display:inline-block;padding:2px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--mute);margin-right:6px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi .v{font-size:22px;font-weight:600;color:var(--strong);font-variant-numeric:tabular-nums}.kpi .l{font-size:12px;color:var(--mute)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
section h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:0 0 8px;font-weight:600}
section.attn{border-color:var(--strong)}ul{margin:0;padding-left:18px}li{margin:6px 0}.d{display:block;color:var(--mute);font-size:13px}
.muted{color:var(--mute);margin:0}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:500}td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.st{font-size:12px;padding:1px 8px;border-radius:999px;background:var(--chip)}.st.done{background:var(--strong);color:var(--bg)}
.bar{height:6px;background:var(--chip);border-radius:3px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:var(--strong)}
a{color:var(--strong)}footer{color:var(--mute);font-size:12px;margin-top:18px}
</style></head><body><main>
<header><h1>Night report: ${esc(log.date)}</h1>
<p><span class="pill">${esc(log.model ?? Object.keys(byModel).join(", "))}</span><span class="pill">${esc(log.session ?? "")}</span><span class="pill">${esc(log.backlogItem ?? "")}</span></p>
<p style="margin-top:8px">${esc(log.summary ?? "")}</p></header>

<div class="kpis">
<div class="kpi"><div class="v">${fmt(tot.in + tot.out + tot.cr + tot.cw)}</div><div class="l">total tokens</div></div>
<div class="kpi"><div class="v">${fmt(tot.out)}</div><div class="l">output tokens</div></div>
<div class="kpi"><div class="v">${fmt(tot.cr)}</div><div class="l">cache reads</div></div>
<div class="kpi"><div class="v">$${cost.toFixed(2)}</div><div class="l">API-equivalent (not your plan bill)</div></div>
<div class="kpi"><div class="v">${leadShare}%</div><div class="l">lead (Fable) share of cost · target &lt; 25%</div></div>
<div class="kpi"><div class="v">${hours.toFixed(1)}h</div><div class="l">first→last activity · ${tot.calls} model calls</div></div>
<div class="kpi"><div class="v">${esc(log.tests?.passed ?? "–")}/${esc((log.tests?.passed ?? 0) + (log.tests?.failed ?? 0) || "–")}</div><div class="l">tests passing</div></div>
</div>

<section class="attn"><h2>Needs you</h2>${list(attn.map((a) => ({ title: a.title, detail: a.detail })), "Nothing needs you.")}</section>
${log.prUrl ? `<section><h2>Pull request</h2><p><a href="${esc(log.prUrl)}">${esc(log.prUrl)}</a></p><p class="muted">Review → merge → the day session deploys.</p></section>` : ""}
<section><h2>Done</h2>${list(log.done)}</section>
<section><h2>Not done</h2>${list(log.notDone)}</section>
<section><h2>Decisions for Brody</h2>${list(log.decisions, "No decisions made on your behalf.")}</section>
<section><h2>Blocked or denied by guardrails</h2>${list(log.blocked, "Nothing was blocked.")}</section>
<section><h2>Pick up next</h2>${list(log.nextPickup)}</section>

<section><h2>Week plan · ${doneCount}/${items.length} done</h2>
<div class="bar"><i style="width:${items.length ? (100 * doneCount) / items.length : 0}%"></i></div>
<table><tr><th>#</th><th>Task</th><th>Status</th><th>Notes</th></tr>
${items.map((i) => `<tr><td class="n">${esc(i.id)}</td><td>${esc(i.title)}</td><td><span class="st ${i.status === "done" ? "done" : ""}">${esc(statusOf[i.status] ?? i.status)}</span></td><td>${esc(i.notes ?? "")}</td></tr>`).join("")}
</table></section>

<section><h2>Tokens by model</h2><table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th></tr>
${Object.entries(byModel).map(([m, b]) => `<tr><td>${esc(m)}</td><td class="n">${fmt(b.in)}</td><td class="n">${fmt(b.out)}</td><td class="n">${fmt(b.cr)}</td><td class="n">${fmt(b.cw)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No transcript found for this window.</td></tr>`}
</table></section>
<footer>Generated ${esc(new Date().toISOString())} from ${esc(basename(logPath))} and ${files.length} transcript file(s). API-equivalent cost uses list prices and is only a relative measure of work done.</footer>
</main></body></html>`;

const out = arg("out") ?? join("docs", "night-reports", `night-${log.date}.html`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`report: ok ${out} · ${fmt(tot.in + tot.out + tot.cr + tot.cw)} tokens · ${attn.length} need you · week ${doneCount}/${items.length}`);
