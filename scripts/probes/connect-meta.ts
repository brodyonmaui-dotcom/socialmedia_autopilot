// One-time Meta token setup (server-side version of the old connect.py).
// Paste a short-lived Graph API Explorer user token (input hidden) → exchange for a long-lived user token →
// derive the Page token for the Page linked to the IG account (no fixed expiry) → write .env. Never prints a token.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { getJson, need, record, startLog, summary } from "./lib.js";

startLog("connect-meta");
const { META_APP_ID, META_APP_SECRET } = need("META_APP_ID", "META_APP_SECRET");
const ver = process.env.META_GRAPH_VERSION ? `/${process.env.META_GRAPH_VERSION}` : "";
const g = (path: string) => `https://graph.facebook.com${ver}${path}`;
const WANTED = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights", "instagram_manage_messages", "pages_show_list", "pages_read_engagement", "business_management"];

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(prompt);
    rlAny._writeToOutput = () => rlAny.output.write("*"); // mask what's typed or pasted
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

function setEnv(pairs: Record<string, string>): void {
  let text = readFileSync(".env", "utf8");
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(".env", text, { mode: 0o600 });
}

const short = await askHidden("Paste the Graph API Explorer token (hidden), then Enter: ");
if (!short) { record("input", false, "nothing pasted"); summary("connect-meta"); }

const ex = await getJson(g(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(short)}`));
const longUser: string | undefined = ex.body?.access_token;
record("exchange", !!longUser, longUser ? "long-lived user token obtained" : `exchange failed: ${ex.body?.error?.message}`);
if (!longUser) summary("connect-meta");

const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
const dbg = await getJson(g(`/debug_token?input_token=${encodeURIComponent(longUser!)}&access_token=${encodeURIComponent(appToken)}`));
const scopes: string[] = dbg.body?.data?.scopes ?? [];
const missing = WANTED.filter((w) => !scopes.includes(w));
record("scopes", missing.length === 0, missing.length ? `missing: ${missing.join(", ")} (re-generate in Explorer with these ticked)` : `all ${WANTED.length} granted`);

const acc = await getJson(g(`/me/accounts?fields=name,access_token,instagram_business_account{id,username}`), { headers: { Authorization: `Bearer ${longUser}` } });
const page = (acc.body?.data ?? []).find((p: any) => p.instagram_business_account);
record("page", !!page, page ? `Page "${page.name}" → @${page.instagram_business_account.username}` : "no Page with a linked IG account");
if (!page) summary("connect-meta");

const pdbg = await getJson(g(`/debug_token?input_token=${encodeURIComponent(page.access_token)}&access_token=${encodeURIComponent(appToken)}`));
const exp = pdbg.body?.data?.expires_at;
const dataExp = pdbg.body?.data?.data_access_expires_at;
const fmt = (s?: number) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : "never");
record("page_token", pdbg.body?.data?.is_valid === true, `type ${pdbg.body?.data?.type} · expires ${fmt(exp)} · data access until ${fmt(dataExp)}`);

setEnv({ META_ACCESS_TOKEN: page.access_token, META_USER_TOKEN: longUser!, IG_USER_ID: page.instagram_business_account.id });
record("env", true, "META_ACCESS_TOKEN (page), META_USER_TOKEN, IG_USER_ID written to .env");
summary("connect-meta");
