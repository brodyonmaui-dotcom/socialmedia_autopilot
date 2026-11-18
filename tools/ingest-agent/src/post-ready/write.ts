import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Platform } from "@autopilot/core";
import { lintText, YOUTUBE_TITLE_MAX } from "@autopilot/research";
import type { ReadyDir } from "../ready/dirs.js";
import { MP4, SIDECAR_SUFFIX } from "../ready/run.js";
import { resolveSidecar, sidecarSchema, type ReadyDirSource, type Sidecar } from "../ready/sidecar.js";

/**
 * `pnpm skill:post-ready write <render.mp4> <draft.json>`: turns a caption draft Claude wrote
 * (/post-ready) into `<name>.post.json` next to the render. The sidecar never carries
 * `approvedInEditor`: these captions were drafted by Claude, not approved in the editor, so every
 * item still needs the phone tap. `when` is always "today" (ingest:ready rolls to tomorrow if full).
 */

export const draftSchema = z
  .object({
    caption: sidecarSchema.shape.caption,
    pillar: sidecarSchema.shape.pillar,
    platforms: sidecarSchema.shape.platforms,
    soundInApp: z.boolean().optional(),
    earliest: sidecarSchema.shape.earliest,
  })
  .strict();

export type Draft = z.infer<typeof draftSchema>;

export const MAX_HASHTAGS = 5;
export const NFA_TEXT = "Not financial advice.";

/**
 * Caption rules for a Claude-drafted sidecar (errors, never warnings):
 *  - every targeted platform except Snapchat has its caption (YouTube: title + description);
 *  - ≤5 hashtags per caption; YouTube title ≤60 chars;
 *  - trade recaps: Instagram, TikTok and the YouTube description say "Not financial advice.";
 *  - voice lint errors (privacy: places, addresses, coordinates, postcodes, blocklist; tone; numbers).
 */
export function validateCaptions(sidecar: Sidecar, opts: { blocklist?: string[] } = {}): string[] {
  const errors: string[] = [];
  const c = sidecar.caption;
  const targeted = new Set<Platform>(sidecar.platforms);
  const texts: Array<{ label: string; text: string; kind: "caption" | "title"; platform: Platform }> = [];
  const need = (label: string, text: string | undefined, kind: "caption" | "title", platform: Platform) => {
    if (!text || text.trim() === "") errors.push(`${label} missing`);
    else texts.push({ label, text, kind, platform });
  };

  if (targeted.has("instagram")) need("instagram caption", c.instagram, "caption", "instagram");
  if (targeted.has("tiktok")) need("tiktok caption", c.tiktok, "caption", "tiktok");
  if (targeted.has("youtube")) {
    need("youtube title", c.youtube?.title, "title", "youtube");
    need("youtube description", c.youtube?.description, "caption", "youtube");
  }
  if (targeted.has("snapchat") && c.snapchat && c.snapchat.trim() !== "") texts.push({ label: "snapchat caption", text: c.snapchat, kind: "caption", platform: "snapchat" });

  for (const t of texts) {
    if (t.kind === "caption") {
      const n = (t.text.match(/#\w+/g) ?? []).length;
      if (n > MAX_HASHTAGS) errors.push(`${t.label} has ${n} hashtags (max ${MAX_HASHTAGS})`);
    } else if ([...t.text].length > YOUTUBE_TITLE_MAX) {
      errors.push(`${t.label} over ${YOUTUBE_TITLE_MAX} chars`);
    }
    if (sidecar.source === "trade-recaps" && t.kind === "caption" && t.platform !== "snapchat" && !t.text.includes(NFA_TEXT)) {
      errors.push(`${t.label} needs "${NFA_TEXT}"`);
    }
    const lint = lintText({ text: t.text, kind: t.kind, platform: t.platform, blocklist: opts.blocklist });
    for (const issue of lint.issues) {
      // Hashtag count and title length are checked above (stricter, same wording every time).
      if (issue.severity !== "error" || issue.rule === "youtube.title" || issue.rule === "hashtags.max") continue;
      errors.push(`${t.label}: ${issue.message} (${issue.rule})`);
    }
  }
  return errors;
}

export interface WriteFs {
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  rename(from: string, to: string): void;
}

export interface PostReadyWriteDeps {
  dirs: ReadyDir[];
  env: Record<string, string | undefined>;
  fs: WriteFs;
  blocklist?: string[];
  /** Windows paths compare case-insensitively. */
  caseInsensitivePaths?: boolean;
}

export type PostReadyWriteResult = { ok: true; name: string; sidecarPath: string; sidecar: Sidecar } | { ok: false; name: string; errors: string[] };

/** Builds the sidecar JSON (pre-resolution) from a draft: when "today", the folder's source, no approvedInEditor. */
export function sidecarFromDraft(draft: Draft, source: ReadyDirSource): Record<string, unknown> {
  return {
    version: 1,
    ...(draft.pillar !== undefined ? { pillar: draft.pillar } : {}),
    ...(draft.platforms !== undefined ? { platforms: draft.platforms } : {}),
    when: "today",
    ...(draft.earliest !== undefined ? { earliest: draft.earliest } : {}),
    caption: draft.caption,
    soundInApp: draft.soundInApp ?? false,
    source,
  };
}

/** Validates and writes `<name>.post.json` atomically (hidden tmp file + rename). Never overwrites. */
export function writePostReady(d: PostReadyWriteDeps, renderPath: string, draftPath: string): PostReadyWriteResult {
  const name = basename(renderPath);
  const fail = (...errors: string[]): PostReadyWriteResult => ({ ok: false, name, errors });
  if (!MP4.test(name)) return fail("render must be an .mp4");
  if (!d.fs.exists(renderPath)) return fail("render not found");

  const norm = (p: string) => (d.caseInsensitivePaths ? resolve(p).toLowerCase() : resolve(p));
  const folder = norm(dirname(renderPath));
  const dir = d.dirs.find((x) => x.source !== null && norm(x.path) === folder);
  if (!dir || dir.source === null) return fail("render is not directly inside a configured source folder (INGEST_READY_DIRS)");
  const source = dir.source;

  const sidecarPath = join(dirname(renderPath), `${name.replace(MP4, "")}${SIDECAR_SUFFIX}`);
  if (d.fs.exists(sidecarPath)) return fail(`${basename(sidecarPath)} already exists; not overwritten`);

  let raw: unknown;
  try {
    raw = JSON.parse(d.fs.readText(draftPath));
  } catch (err) {
    return fail(`draft is not valid JSON (${String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 120)})`);
  }
  const draft = draftSchema.safeParse(raw);
  if (!draft.success) {
    const issue = draft.error.issues[0]!;
    return fail(`draft ${issue.path.length ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`);
  }

  const resolved = resolveSidecar(sidecarFromDraft(draft.data, source), source, d.env);
  if (!resolved.ok) return fail(`${resolved.path}: ${resolved.message}`);
  const errors = validateCaptions(resolved.value, { blocklist: d.blocklist });
  if (errors.length) return fail(...errors);

  const tmp = join(dirname(renderPath), `.${basename(sidecarPath)}.tmp`);
  d.fs.writeText(tmp, `${JSON.stringify(resolved.value, null, 2)}\n`);
  d.fs.rename(tmp, sidecarPath);
  return { ok: true, name, sidecarPath, sidecar: resolved.value };
}

export function postReadyLine(r: PostReadyWriteResult): string {
  return r.ok ? `post-ready: wrote ${basename(r.sidecarPath)}` : `post-ready: FAIL ${r.name}: ${r.errors.join("; ")}`;
}
