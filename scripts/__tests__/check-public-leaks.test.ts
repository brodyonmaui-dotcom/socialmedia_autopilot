import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// F7 B9: the public-repo leak scanner.
const script = fileURLToPath(new URL("../check-public-leaks.mjs", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const scan = (root: string, env: Record<string, string> = {}) => {
  const { PRIVACY_BLOCKLIST: _drop, ...base } = process.env;
  const r = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8", env: { ...base, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
};

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "leak-check-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("check-public-leaks", () => {
  it("runs clean on the current repo", () => {
    const r = scan(repo);
    expect(r.out).toMatch(/^check-public-leaks: ok \(\d+ files\)/m);
    expect(r.code).toBe(0);
  });

  it.each([
    ["docs/notes.md", "server is at 203.1.45.67 now", "ipv4"],
    ["infra/Caddyfile", "reverse_proxy 172.16.4.2:3000", "ipv4"],
    ["docs/zone.md", "creator lives on Pacific/Auckland time", "time-zone"],
    ["README.md", "files in C:\\Clips\\ready", "personal-path"],
    ["docs/a.md", "see /Users/someone/Desktop", "personal-path"],
    ["docs/b.md", "copy to /home/alice/clips", "personal-path"],
    ["docs/c.md", "run `ssh root@vps.realhost.net`", "ssh-host"],
    ["docs/d.md", "his Instagram is @real.person_99", "handle"],
  ])("%s with an injected leak fails as %s, without echoing it", (rel, body, rule) => {
    const r = scan(fixture({ [rel]: `# ok line\n${body}\n` }));
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${rel}:2: ${rule}`);
    expect(r.out).not.toContain(body);
  });

  it("allows the documented exceptions", () => {
    const dir = fixture({
      "docs/ok.md": [
        "bind 127.0.0.1 and 0.0.0.0, private 10.0.0.5, docs range 192.0.2.10",
        "fixture zone Europe/London, or UTC",
        "IANA zone, e.g. Asia/Tokyo",
        "work in /home/user/socialmedia_autopilot, service user /home/deploy",
        "ssh autopilot, then ssh <host>",
        "post to Instagram as @username; deps @autopilot/core",
        "version 1.2.3 and v25.0",
      ].join("\n"),
      "apps/web/src/page.tsx": "const ip = '203.1.45.67'; // out of scope (not docs/infra/md)",
    });
    expect(scan(dir)).toMatchObject({ code: 0 });
  });

  it("PRIVACY_BLOCKLIST hits are counted, never printed", () => {
    const dir = fixture({ "docs/x.md": "leg day near Springfield again\n" });
    const r = scan(dir, { PRIVACY_BLOCKLIST: "springfield, other" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("docs/x.md:1: privacy-blocklist");
    expect(r.out).toContain("(1 blocklist)");
    expect(r.out).not.toMatch(/springfield/i);
  });
});
