import { z } from "zod";

/**
 * The F15 sidecar contract, version 1 (docs/design/F15.md "The contract"). Keep identical: the
 * editing chats write against it. `.strict()` everywhere so a typo'd key fails loudly.
 */
export const SIDECAR_PILLARS = ["trade-recap", "workout-log", "physique", "single-set", "yap", "other"] as const;
export const SIDECAR_PLATFORMS = ["instagram", "youtube", "tiktok", "snapchat"] as const;
export const SIDECAR_WHEN = ["today", "tomorrow", "this-week"] as const;
export const SIDECAR_SOURCES = ["workout-assembly", "trade-recaps", "manual"] as const;

export const sidecarSchema = z
  .object({
    version: z.literal(1),
    pillar: z.enum(SIDECAR_PILLARS).optional(),
    platforms: z
      .array(z.enum(SIDECAR_PLATFORMS))
      .min(1, "at least one platform")
      .refine((a) => new Set(a).size === a.length, "platforms must be unique")
      .optional(),
    when: z.enum(SIDECAR_WHEN),
    earliest: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "earliest must be HH:MM (00:00-23:59)")
      .optional(),
    caption: z
      .object({
        instagram: z.string().optional(),
        tiktok: z.string().optional(),
        youtube: z.object({ title: z.string().optional(), description: z.string().optional() }).strict().optional(),
        snapchat: z.string().optional(),
      })
      .strict(),
    soundInApp: z.boolean().default(false),
    /** Absent = not approved in the editor (e.g. drafted by /post-ready): the phone tap is still needed. */
    approvedInEditor: z.iso.datetime({ offset: true }).optional(),
    source: z.enum(SIDECAR_SOURCES).optional(),
  })
  .strict();

/** The sidecar as written on disk: pillar/platforms/source may come from the folder's defaults. */
export type SidecarFile = z.infer<typeof sidecarSchema>;

/** A resolved sidecar: pillar, platforms and source always set. `approvedInEditor` stays optional. */
export type Sidecar = Omit<SidecarFile, "pillar" | "platforms" | "source"> & {
  pillar: NonNullable<SidecarFile["pillar"]>;
  platforms: NonNullable<SidecarFile["platforms"]>;
  source: NonNullable<SidecarFile["source"]>;
};

export type SidecarParse = { ok: true; value: Sidecar } | { ok: false; path: string; message: string };

/** The ready folder kinds that carry defaults (`manual` is sidecar-only). */
export type ReadyDirSource = "trade-recaps" | "workout-assembly";

type Env = Record<string, string | undefined>;

/**
 * Per-folder defaults. Snapchat is opt-in (INGEST_SNAPCHAT_DEFAULT=on) for workout renders only:
 * the Snapchat account doesn't exist yet, so it's off by default.
 */
export function sourceDefaults(source: ReadyDirSource, env: Env = {}): { pillar: Sidecar["pillar"]; platforms: Sidecar["platforms"] } {
  switch (source) {
    case "trade-recaps":
      return { pillar: "trade-recap", platforms: ["instagram", "youtube", "tiktok"] };
    case "workout-assembly":
      return {
        pillar: "workout-log",
        platforms: env.INGEST_SNAPCHAT_DEFAULT === "on" ? ["instagram", "youtube", "tiktok", "snapchat"] : ["instagram", "youtube", "tiktok"],
      };
  }
}

/**
 * Validates parsed JSON and fills pillar/platforms/source from the folder (`dirSource`; null for the
 * legacy INGEST_READY_DIR, where the sidecar must carry them). A sidecar whose `source` disagrees with
 * the folder fails on `source`. On failure: the first issue's dotted path ("(root)" when top-level) + message.
 */
export function resolveSidecar(json: unknown, dirSource: ReadyDirSource | null, env: Env = {}): SidecarParse {
  const r = sidecarSchema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
    return { ok: false, path, message: issue.message };
  }
  const file = r.data;
  if (dirSource && file.source && file.source !== dirSource) {
    return { ok: false, path: "source", message: `sidecar says ${file.source} but folder is ${dirSource}` };
  }
  const defaults = dirSource ? sourceDefaults(dirSource, env) : null;
  const pillar = file.pillar ?? defaults?.pillar;
  const platforms = file.platforms ?? defaults?.platforms;
  const source = file.source ?? dirSource ?? undefined;
  for (const [path, v] of [["pillar", pillar], ["platforms", platforms], ["source", source]] as const) {
    if (v === undefined) return { ok: false, path, message: `${path} is required (no folder default)` };
  }
  const { approvedInEditor, ...rest } = file;
  const value: Sidecar = { ...rest, pillar: pillar!, platforms: [...platforms!], source: source! };
  if (approvedInEditor !== undefined) value.approvedInEditor = approvedInEditor;
  return { ok: true, value };
}

/** Legacy form: no folder defaults, so pillar/platforms/source must be in the sidecar. */
export function parseSidecar(json: unknown): SidecarParse {
  return resolveSidecar(json, null);
}
