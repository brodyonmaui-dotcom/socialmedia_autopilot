import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// D7 (docs/design/F7.md): /snap-test is public (Caddy serves infra/static/snap-test.html without auth),
// so it must stay a bare test page: no media, no real captions, no way into the app or the DB.
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const staticDir = join(repoRoot, "infra/static");
const caddy = readFileSync(join(repoRoot, "infra/Caddyfile"), "utf8");
const snap = readFileSync(join(staticDir, "snap-test.html"), "utf8");

describe("public /snap-test (D7)", () => {
  it("is the file Caddy serves for /snap-test*", () => {
    expect(caddy).toMatch(/handle \/snap-test\* \{\s*root \* \/srv\/static\s*rewrite \* \/snap-test\.html/);
  });

  it("the public static dir holds only small html/json/txt files (no media)", () => {
    for (const f of readdirSync(staticDir)) {
      if (f === "assets") continue; // checked below
      expect(f, f).toMatch(/\.(html|json|txt|css|ico|svg)$/);
      expect(f, f).not.toMatch(/\.(mp4|mov|m4v|webm|jpe?g|png|heic|gif)$/i);
    }
  });

  it("assets/ (site CSS + self-hosted fonts) holds only css, woff2 and licence text, no media", () => {
    const files = readdirSync(join(staticDir, "assets"), { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const d of files) {
      expect(d.name, d.name).toMatch(/\.(css|woff2|txt)$/);
    }
  });

  it("references no .mp4 except the URL placeholder and the generated share filename", () => {
    const stripped = snap.replace('placeholder="https://…/video.mp4"', "").replace("'post.mp4'", "");
    expect(stripped).not.toMatch(/\.mp4/i);
    expect(snap).not.toMatch(/<(video|img|source|audio)\b/i);
  });

  it("carries no caption text beyond the dummy test string", () => {
    const textareas = [...snap.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/g)].map((m) => m[1]);
    expect(textareas).toEqual(["test caption — ignore"]);
    // No hashtags in the visible markup (real captions carry them); <style>/<script> hold CSS colours and ids.
    const markup = snap.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(markup).not.toMatch(/(^|[\s>])#[A-Za-z]\w+/);
  });

  it("has no DB, API or dashboard access and loads nothing external", () => {
    expect(snap).not.toMatch(/\/app\b|\/api\b|postgres|DATABASE|supabase|zernio|graph\.facebook|googleapis/i);
    expect(snap).not.toMatch(/<script[^>]+src=/i);
    expect(snap).not.toMatch(/<link[^>]+href=/i);
    // The only fetch is of the URL the tester types in.
    expect([...snap.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["u"]);
  });
});
