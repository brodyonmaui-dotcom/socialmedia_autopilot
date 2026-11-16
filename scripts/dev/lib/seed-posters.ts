// Dev only: one synthetic poster per demo clip, so local screenshots show real thumbnails without R2.
// Abstract (soft vertical gradient + one circle, hue varied per clip): no text, no real imagery, no
// metadata. Files go to logs/dev-posters/demo/<hash>.jpg (gitignored); media.poster_key = 'demo/<hash>.jpg'.
// The web app serves them only with DEV_POSTER_DIR=<abs>/logs/dev-posters and only for demo/ keys.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEMO_HASH_PREFIX } from "./seed.js";

const execFileAsync = promisify(execFile);

/** Absolute path of the dev poster dir (what DEV_POSTER_DIR should be set to). */
export const DEV_POSTER_DIR = resolve(fileURLToPath(new URL("../../../logs/dev-posters", import.meta.url)));

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** ffmpeg lavfi args for poster n (pure): hue walks the colour wheel, the circle moves with n. */
export function syntheticPosterArgs(n: number, out: string): string[] {
  const angle = ((n * 47) % 360) * (Math.PI / 180);
  const cx = 0.3 + ((n * 37) % 41) / 100; // 0.30–0.70 of the width
  const cy = 0.25 + ((n * 53) % 36) / 100; // 0.25–0.60 of the height
  const r = 0.16 + ((n * 29) % 10) / 100;
  const lum = `70+90*(1-Y/H)+if(lt(hypot(X-${cx.toFixed(2)}*W,Y-${cy.toFixed(2)}*H),${r.toFixed(2)}*W),40,0)`;
  const cb = (128 + 38 * Math.cos(angle)).toFixed(1);
  const cr = (128 + 38 * Math.sin(angle)).toFixed(1);
  return [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=gray:s=360x640:d=1,format=yuv444p,geq=lum='${lum}':cb='${cb}':cr='${cr}'`,
    "-frames:v",
    "1",
    "-map_metadata",
    "-1",
    "-pix_fmt",
    "yuvj420p",
    "-q:v",
    "5",
    out,
  ];
}

/**
 * Idempotent: existing files are kept, poster_key is set only where it differs. Generates in parallel
 * (8 at a time) so 56 clips take a second or two. Returns counts for the seed's summary line.
 */
export async function seedDemoPosters(db: Queryable, dir = DEV_POSTER_DIR): Promise<{ total: number; made: number; dir: string }> {
  const rows = (await db.query("select id, content_hash from media where content_hash like $1 order by content_hash", [`${DEMO_HASH_PREFIX}%`])).rows as Array<{
    id: string;
    content_hash: string;
  }>;
  mkdirSync(join(dir, "demo"), { recursive: true });
  let made = 0;
  const todo = rows.map((r, n) => ({ ...r, n, key: `demo/${r.content_hash}.jpg` })).filter((r) => /^[A-Za-z0-9_-]+$/.test(r.content_hash));
  const missing = todo.filter((r) => !existsSync(join(dir, r.key)));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (r) => {
        await execFileAsync("ffmpeg", syntheticPosterArgs(r.n, join(dir, r.key)));
        made++;
      }),
    );
  }
  for (const r of todo) await db.query("update media set poster_key = $2 where id = $1 and poster_key is distinct from $2", [r.id, r.key]);
  return { total: todo.length, made, dir };
}
