import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  adapterEnvNames,
  backupKeyToIso,
  caddySites,
  dbFactsFromJson,
  exitCodeFor,
  formatLine,
  isForbiddenTracked,
  leakScanFromOutput,
  newestProbeDate,
  parseAudit,
  PREFLIGHT_SQL,
  REPO_FILES,
  runChecks,
  summaryLine,
  type CheckResult,
  type PreflightInput,
  type RepoFacts,
} from "../lib/preflight.js";

// F13 T1: go-live preflight. Fixture secrets are distinctive so a grep proves none is printed.
const repo = fileURLToPath(new URL("../..", import.meta.url));
const NOW = new Date("2026-11-14T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);

const SECRETS = {
  DATABASE_URL: "postgres://ap:fxSecretDbPw91@db:5432/autopilot",
  META_ACCESS_TOKEN: "fxSecretMetaToken77",
  IG_USER_ID: "fxSecretIgUser55",
  GOOGLE_CLIENT_ID: "fxSecretGoogleId31",
  GOOGLE_CLIENT_SECRET: "fxSecretGoogleSecret12",
  YT_REFRESH_TOKEN: "fxSecretYtRefresh48",
  ZERNIO_API_KEY: "fxSecretZernioKey66",
  ZERNIO_TIKTOK_ACCOUNT_ID: "fxSecretZernioAcct29",
  VAPID_PUBLIC_KEY: "fxSecretVapidPub83",
  VAPID_PRIVATE_KEY: "fxSecretVapidPriv14",
  VAPID_SUBJECT: "mailto:fxsecret-subject@example.com",
};
const ENV: Record<string, string> = {
  ...SECRETS,
  PUBLIC_MEDIA_BASE: "https://media.example.com",
  TZ_CREATOR: "Europe/London",
  DRY_RUN: "true",
  DOMAIN: "autopilot.example.com",
};
const SECRET_VALUES = [...Object.values(SECRETS), "fxSecretDbPw91"];

const MIGRATIONS = ["0001_init.sql", "0002_settings.sql", "0003_research.sql", "0004_analytics.sql", "0005_outbox.sql", "0006_auth_approval.sql", "0007_engagement.sql", "0008_alerts_push.sql"];
const researchLog = (ytAgeMs = 2 * D) =>
  [
    `### M0 result — Instagram (${day(3 * D)}, probe on the VPS)`,
    `### Probe results — YouTube read-only (${day(ytAgeMs)}, probe on the VPS)`,
    `### Zernio free plan and TikTok limits (${day(4 * D)}, docs only)`,
    "Body text naming YouTube (2020-01-01) is not a heading and is ignored.",
  ].join("\n");

const readRepo = (rel: string) => {
  try {
    return readFileSync(join(repo, rel), "utf8");
  } catch {
    return undefined;
  }
};
const realFiles = (): RepoFacts["files"] => Object.fromEntries(Object.values(REPO_FILES).map((rel) => [rel, readRepo(rel)]));
const CLEAN_AUDIT = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
const repoFacts = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  files: realFiles(),
  leakScan: { ok: true, files: [] },
  trackedFiles: ["package.json", ".env.example", "infra/Caddyfile"],
  audit: CLEAN_AUDIT,
  ...over,
});

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    env: { ...ENV },
    appliedMigrations: [...MIGRATIONS],
    expectedMigrations: [...MIGRATIONS],
    passkeyCount: 1,
    settings: { cadence: {}, restoreDrillAt: iso(3 * D) },
    lastBackupAt: iso(2 * H),
    researchLog: researchLog(),
    now: NOW,
    ...over,
  };
}
const byId = (rs: CheckResult[], id: string) => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no check ${id}`);
  return r;
};
const output = (rs: CheckResult[]) => [...rs.map(formatLine), summaryLine(rs)].join("\n");

describe("runChecks: F13 core", () => {
  it("fixture env with every name set: all PASS (only security-headers may WARN, see Caddyfile)", () => {
    const rs = runChecks(input({ repo: repoFacts() }));
    const notPass = rs.filter((r) => r.status !== "PASS").map((r) => r.id);
    expect(notPass.filter((id) => id !== "security-headers")).toEqual([]);
    expect(rs.every((r) => r.status !== "FAIL")).toBe(true);
    expect(exitCodeFor(rs)).toBe(0);
    expect(formatLine(byId(rs, "migrations"))).toBe("PASS migrations: 0001-0008 applied");
    const out = output(rs);
    for (const v of SECRET_VALUES) expect(out).not.toContain(v);
  });

  it("each missing required name FAILs naming the variable, never a value", () => {
    const names = ["DATABASE_URL", "PUBLIC_MEDIA_BASE", "TZ_CREATOR", "DRY_RUN", ...adapterEnvNames().required];
    expect(adapterEnvNames().required).toEqual(expect.arrayContaining(["META_ACCESS_TOKEN", "IG_USER_ID", "YT_REFRESH_TOKEN", "ZERNIO_API_KEY"]));
    expect(adapterEnvNames().required).not.toContain("META_GRAPH_VERSION"); // optional: read, but not needed
    for (const name of names) {
      const env = { ...ENV };
      delete env[name];
      const rs = runChecks(input({ env }));
      const r = byId(rs, "env");
      expect(r.status).toBe("FAIL");
      expect(r.summary).toBe(`not set: ${name}`);
      expect(r.next).toBeTruthy();
      expect(exitCodeFor(rs)).toBe(1);
      const out = output(rs);
      for (const v of SECRET_VALUES) expect(out).not.toContain(v);
    }
  });

  it("empty string counts as missing", () => {
    expect(byId(runChecks(input({ env: { ...ENV, YT_REFRESH_TOKEN: "  " } })), "env").summary).toContain("YT_REFRESH_TOKEN");
  });

  it.each(["ftp://media.example.com", "https://media.example.com/?sig=fxSecretSig1", "https://fxuser:fxSecretPw2@media.example.com", "not a url", ""])(
    "bad PUBLIC_MEDIA_BASE FAILs (isValidMediaBase): %s",
    (base) => {
      const r = byId(runChecks(input({ env: { ...ENV, PUBLIC_MEDIA_BASE: base } })), "media-base");
      expect(r.status).toBe("FAIL");
      expect(r.next).toMatch(/\.env/);
      expect(formatLine(r)).not.toContain("fxSecret");
    },
  );

  it("tz: invalid zone FAILs without printing it", () => {
    const r = byId(runChecks(input({ env: { ...ENV, TZ_CREATOR: "Mars/Olympus_Mons" } })), "tz");
    expect(r.status).toBe("FAIL");
    expect(formatLine(r)).not.toContain("Mars");
    expect(byId(runChecks(input()), "tz").status).toBe("PASS");
  });

  it("7 of 8 migrations FAILs with the runbook path", () => {
    const r = byId(runChecks(input({ appliedMigrations: MIGRATIONS.slice(0, 7) })), "migrations");
    expect(r.status).toBe("FAIL");
    expect(r.summary).toContain("0008_alerts_push.sql");
    expect(r.next).toBe("docs/runbooks/migrations.md");
  });

  it("passkey: zero FAILs with the login runbook, one passes", () => {
    expect(formatLine(byId(runChecks(input({ passkeyCount: 0 })), "passkey"))).toBe("FAIL passkey: none enrolled -> docs/runbooks/login.md");
    expect(byId(runChecks(input({ passkeyCount: 1 })), "passkey").status).toBe("PASS");
  });

  it("run-mode: dry PASS in words, one key PASS, live WARN (never FAIL)", () => {
    expect(formatLine(byId(runChecks(input()), "run-mode"))).toBe("PASS run-mode: dry-run: nothing publishes");
    expect(byId(runChecks(input({ env: { ...ENV, DRY_RUN: "false" } })), "run-mode").status).toBe("PASS");
    expect(byId(runChecks(input({ env: { ...ENV, DRY_RUN: "false", WORKER_LIVE: "1" } })), "run-mode").status).toBe("WARN");
  });

  it("vapid: any missing → WARN with the alerts-push runbook", () => {
    const env = { ...ENV };
    delete env.VAPID_SUBJECT;
    const r = byId(runChecks(input({ env })), "vapid");
    expect(r.status).toBe("WARN");
    expect(r.summary).toContain("VAPID_SUBJECT");
    expect(r.next).toBe("docs/runbooks/alerts-push.md");
  });

  it("backup: 25 h FAILs, 2 h passes, unknown WARNs", () => {
    const old = byId(runChecks(input({ lastBackupAt: iso(25 * H) })), "backup");
    expect(old.status).toBe("FAIL");
    expect(old.next).toBe("docs/runbooks/restore.md");
    expect(byId(runChecks(input({ lastBackupAt: iso(2 * H) })), "backup").status).toBe("PASS");
    expect(byId(runChecks(input({ lastBackupAt: null })), "backup").status).toBe("WARN");
  });

  it("restore-drill: none recorded FAILs, recorded passes", () => {
    const r = byId(runChecks(input({ settings: { cadence: {} } })), "restore-drill");
    expect(r.status).toBe("FAIL");
    expect(r.next).toContain("./infra/restore-test.sh");
    expect(byId(runChecks(input()), "restore-drill").status).toBe("PASS");
  });

  it("cadence: invalid settings FAIL via normalizeCadence", () => {
    expect(byId(runChecks(input({ settings: { cadence: { slotsPerDay: 99 }, restoreDrillAt: iso(D) } })), "cadence").status).toBe("FAIL");
    expect(byId(runChecks(input({ settings: { cadence: { dailyCaps: { youtube: -1 } }, restoreDrillAt: iso(D) } })), "cadence").status).toBe("FAIL");
  });

  it("probe-log: 31-day-old yt entry WARNs with the probe command, recent passes", () => {
    const stale = byId(runChecks(input({ researchLog: researchLog(31 * D) })), "probe-log yt");
    expect(stale.status).toBe("WARN");
    expect(stale.next).toContain("./infra/probe.sh yt");
    expect(byId(runChecks(input({ researchLog: researchLog(2 * D) })), "probe-log yt").status).toBe("PASS");
    expect(byId(runChecks(input({ researchLog: "" })), "probe-log ig").status).toBe("WARN");
  });

  it("probe-log parses the real research.md headings", () => {
    const log = readRepo("docs/research.md") ?? "";
    expect(newestProbeDate(log, "ig")).not.toBeNull();
    expect(newestProbeDate(log, "yt")).not.toBeNull();
    expect(newestProbeDate(log, "tiktok")).not.toBeNull();
    expect(newestProbeDate("### M0 results — YouTube + TikTok (2026-11-10/11)", "tiktok")?.toISOString().slice(0, 10)).toBe("2026-11-10");
  });

  it("unreachable DB: FAIL lines (not a throw)", () => {
    const rs = runChecks(input({ appliedMigrations: null, passkeyCount: null, settings: {} }));
    for (const id of ["migrations", "passkey", "restore-drill", "cadence"]) {
      expect(byId(rs, id).status).toBe("FAIL");
      expect(byId(rs, id).summary).toContain("database unreachable");
    }
    expect(exitCodeFor(rs)).toBe(1);
  });

  it("every FAIL has a next step; summary line counts", () => {
    const rs = runChecks(input({ appliedMigrations: null, passkeyCount: null, settings: {}, env: {}, lastBackupAt: iso(30 * H), repo: repoFacts({ files: {} }) }));
    for (const r of rs.filter((x) => x.status === "FAIL")) expect(r.next, r.id).toBeTruthy();
    expect(summaryLine(rs)).toMatch(/^preflight: \d+ pass · \d+ warn · \d+ fail$/);
  });
});

describe("pre-launch security checks", () => {
  const sec = (over: Partial<RepoFacts>, env = ENV) => runChecks(input({ env: { ...env }, repo: repoFacts(over) }));

  it("secrets-git: pass; tracked .env / secrets folder FAILs listing file names only; leak hits FAIL", () => {
    expect(byId(sec({}), "secrets-git").status).toBe("PASS");
    const r = byId(sec({ trackedFiles: ["package.json", ".env", "apps/web/.env.local", ".env.example", ".secrets/meta.json"] }), "secrets-git");
    expect(r.status).toBe("FAIL");
    expect(r.summary).toContain(".env, apps/web/.env.local, .secrets/meta.json");
    expect(r.summary).not.toContain(".env.example");
    const leak = byId(sec({ leakScan: { ok: false, files: ["docs/x.md"] } }), "secrets-git");
    expect(leak.status).toBe("FAIL");
    expect(leak.summary).toContain("docs/x.md");
    expect(byId(sec({ trackedFiles: null }), "secrets-git").status).toBe("WARN");
    expect(isForbiddenTracked(".env.example")).toBe(false);
  });

  it("secrets-git: leak scanner output parses to file names", () => {
    expect(leakScanFromOutput(1, "docs/a.md:3: ipv4\ndocs/a.md:9: time-zone\nREADME.md:1: handle\ncheck-public-leaks: FAIL 3 hit(s)")).toEqual({ ok: false, files: ["docs/a.md", "README.md"] });
  });

  it("session-cookie: real code passes; a missing flag FAILs naming it", () => {
    expect(byId(sec({}), "session-cookie").status).toBe("PASS");
    const files = realFiles();
    const src = files[REPO_FILES.session]!;
    for (const [from, to, flag] of [
      ["httpOnly: true, ", "", "httpOnly"],
      ['sameSite: "strict", ', 'sameSite: "none", ', "sameSite"],
      ['path: "/app", ', 'path: "/", ', "path"],
      ["secure, ", "", "secure"],
    ] as const) {
      expect(src).toContain(from);
      const r = byId(sec({ files: { ...files, [REPO_FILES.session]: src.replace(from, to) } }), "session-cookie");
      expect(r.status, flag).toBe("FAIL");
      expect(r.summary).toContain(flag);
    }
    const cfg = files[REPO_FILES.authConfig]!.replace(/(if \(domain\)[^\n]*)secureCookie: true/, "$1secureCookie: false");
    expect(byId(sec({ files: { ...files, [REPO_FILES.authConfig]: cfg } }), "session-cookie").summary).toContain("secure in production");
  });

  it("login-rate-limit: real code passes; changed constant or unwired login FAILs", () => {
    expect(byId(sec({}), "login-rate-limit").status).toBe("PASS");
    const files = realFiles();
    const loose = files[REPO_FILES.rateLimit]!.replace("MAX_FAILURES = 10", "MAX_FAILURES = 100");
    expect(byId(sec({ files: { ...files, [REPO_FILES.rateLimit]: loose } }), "login-rate-limit").summary).toContain("MAX_FAILURES = 10");
    const wa = files[REPO_FILES.webauthn]!;
    const unwired = wa.replace(/(export async function beginLogin[\s\S]*?)await assertNotRateLimited\(d\.store, now\);/, "$1");
    expect(unwired).not.toBe(wa);
    const r = byId(sec({ files: { ...files, [REPO_FILES.webauthn]: unwired } }), "login-rate-limit");
    expect(r.status).toBe("FAIL");
    expect(r.summary).toContain("beginLogin calls assertNotRateLimited");
  });

  it("security-headers: all four PASS; missing ones WARN by name", () => {
    const full = 'header {\n Strict-Transport-Security "max-age=31536000"\n X-Content-Type-Options nosniff\n Referrer-Policy strict-origin\n X-Frame-Options DENY\n}';
    expect(byId(sec({ files: { ...realFiles(), [REPO_FILES.caddyfile]: `{$DOMAIN} {\n${full}\n}` } }), "security-headers").status).toBe("PASS");
    const r = byId(sec({ files: { ...realFiles(), [REPO_FILES.caddyfile]: "{$DOMAIN} {\n respond ok\n}", [REPO_FILES.nextConfig]: "" } }), "security-headers");
    expect(r.status).toBe("WARN");
    expect(r.summary).toBe("missing: Strict-Transport-Security, X-Content-Type-Options nosniff, Referrer-Policy, X-Frame-Options or CSP frame-ancestors");
    const next = "headers: [{ key: \"Content-Security-Policy\", value: \"frame-ancestors 'none'\" }]";
    const viaNext = byId(sec({ files: { ...realFiles(), [REPO_FILES.nextConfig]: next } }), "security-headers");
    expect(viaNext.status).toBe("PASS");
  });

  it("https: real Caddyfile passes with DOMAIN set; plain http site, auto_https off, no DOMAIN or http WEB_ORIGIN FAIL", () => {
    expect(byId(sec({}), "https").status).toBe("PASS");
    const caddy = realFiles()[REPO_FILES.caddyfile]!;
    const withFiles = (c: string) => ({ files: { ...realFiles(), [REPO_FILES.caddyfile]: c } });
    expect(byId(sec(withFiles(`http://{$DOMAIN} {\n respond ok\n}\n`)), "https").summary).toContain("plain http://");
    expect(byId(sec(withFiles(`http://{$DOMAIN} {\n redir https://{host}{uri}\n}\n${caddy}`)), "https").status).toBe("PASS");
    expect(byId(sec(withFiles(`{\n auto_https off\n}\n${caddy}`)), "https").summary).toContain("auto_https");
    const noDomain = { ...ENV } as Record<string, string>;
    delete noDomain.DOMAIN;
    expect(byId(sec({}, noDomain), "https").summary).toContain("DOMAIN not set");
    const r = byId(sec({}, { ...ENV, WEB_ORIGIN: "http://fxsecret-origin.example.com" }), "https");
    expect(r.status).toBe("FAIL");
    expect(r.summary).toContain("WEB_ORIGIN");
    expect(formatLine(r)).not.toContain("fxsecret-origin");
    expect(caddySites(caddy).map((s) => s.address)).toEqual(["{$DOMAIN}"]);
  });

  it("deps-audit: clean PASS; high/critical WARN; not run WARN; parses pnpm audit json", () => {
    expect(byId(sec({}), "deps-audit").status).toBe("PASS");
    const r = byId(sec({ audit: { ...CLEAN_AUDIT, high: 2, critical: 1 } }), "deps-audit");
    expect(r.status).toBe("WARN");
    expect(r.summary).toContain("critical 1, high 2");
    expect(r.next).toBe("pnpm audit --prod");
    expect(byId(sec({ audit: null }), "deps-audit").summary).toContain("audit not run");
    expect(byId(sec({ audit: undefined }), "deps-audit").status).toBe("WARN");
    expect(parseAudit('{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":2,"high":3,"critical":0}}}')).toEqual({ info: 0, low: 1, moderate: 2, high: 3, critical: 0 });
    expect(parseAudit("ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS")).toBeNull();
  });
});

describe("helpers", () => {
  it("backup key → ISO", () => {
    expect(backupKeyToIso("autopilot-20261114T030000Z.sql.gz")).toBe("2026-11-14T03:00:00Z");
    expect(backupKeyToIso(null)).toBeNull();
  });
  it("dbFactsFromJson merges posting_windows over cadence like loadCadence", () => {
    const f = dbFactsFromJson({ migrations: ["0001_init.sql"], passkeys: 2, settings: { cadence: { slotsPerDay: 3 }, posting_windows: [{ start: "09:00", end: "10:00" }], restore_drill_at: "2026-11-13T00:00:00Z" } });
    expect(f).toEqual({ appliedMigrations: ["0001_init.sql"], passkeyCount: 2, settings: { cadence: { slotsPerDay: 3, windows: [{ start: "09:00", end: "10:00" }] }, restoreDrillAt: "2026-11-13T00:00:00Z" } });
  });
});

describe("static: the preflight's SQL is read-only", () => {
  const sources = ["scripts/lib/preflight.ts", "scripts/lib/preflight-db.ts", "scripts/preflight.ts", "infra/preflight.sh"];
  it.each(sources)("%s has no insert|update|delete", (rel) => {
    expect(readRepo(rel)).toBeDefined();
    expect(readRepo(rel)).not.toMatch(/\b(insert|update|delete)\b/i);
  });
  it("the wrapper runs exactly PREFLIGHT_SQL", () => {
    expect(readRepo("infra/preflight.sh")).toContain(`SQL="${PREFLIGHT_SQL}"`);
  });
  it("restore-test.sh records restore_drill_at on success and keeps its output line", () => {
    const s = readRepo("infra/restore-test.sh")!;
    expect(s).toContain("restore_drill_at");
    expect(s).toContain('echo "restore ok $key tables=$n"');
    expect(s.indexOf("restore_drill_at")).toBeLessThan(s.indexOf('echo "restore ok'));
  });
});

describe("CLI (pnpm preflight)", () => {
  const tsx = join(repo, "node_modules/.bin/tsx");
  const cli = join(repo, "scripts/preflight.ts");
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (env: Record<string, string>, args: string[]) => {
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !(k in ENV) && !/^(VAPID|WEB_ORIGIN|WORKER_LIVE|PRIVACY_BLOCKLIST)/.test(k))) as Record<string, string>;
    const r = spawnSync(tsx, [cli, ...args], { cwd: dir, encoding: "utf8", env: { ...base, ...env }, timeout: 60_000 });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const facts = (db: unknown, backupKey: string | null) => {
    const p = join(dir, `facts-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify({ db, backupKey }));
    return p;
  };
  const freshKey = `autopilot-${new Date(Date.now() - H).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z.sql.gz`;
  const onDisk = readdirSync(join(repo, "packages/db/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const goodDb = { migrations: onDisk, passkeys: 1, settings: { restore_drill_at: new Date().toISOString() } };

  it("all facts good: exit 0, one line per check + summary, no secret value printed", () => {
    const { code, out } = run(ENV, ["--facts", facts(goodDb, freshKey)]);
    const lines = out.trim().split("\n");
    expect(lines.at(-1)).toMatch(/^preflight: \d+ pass · \d+ warn · 0 fail$/);
    expect(lines.slice(0, -1).every((l) => /^(PASS|WARN|FAIL) [\w -]+: /.test(l))).toBe(true);
    expect(code).toBe(0);
    for (const v of SECRET_VALUES) expect(out).not.toContain(v);
  }, 60_000);

  it("7 of 8 migrations: exit 1", () => {
    const { code, out } = run(ENV, ["--facts", facts({ ...goodDb, migrations: onDisk.slice(0, -1) }, freshKey)]);
    expect(code).toBe(1);
    expect(out).toContain("-> docs/runbooks/migrations.md");
  }, 60_000);

  it("unreachable DB: FAIL lines, no stack trace, no password, exit 1", () => {
    const { code, out } = run({ ...ENV, DATABASE_URL: "postgres://ap:fxSecretDbPw91@127.0.0.1:1/none" }, []);
    expect(code).toBe(1);
    expect(out).toContain("FAIL migrations: database unreachable");
    expect(out).toContain("FAIL passkey: database unreachable");
    expect(out).not.toMatch(/\n\s+at |Error:|ECONNREFUSED/);
    expect(out).not.toContain("fxSecretDbPw91");
  }, 60_000);
});
