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
    pillar: z.enum(SIDECAR_PILLARS),
    platforms: z
      .array(z.enum(SIDECAR_PLATFORMS))
      .min(1, "at least one platform")
      .refine((a) => new Set(a).size === a.length, "platforms must be unique"),
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
    soundInApp: z.boolean(),
    approvedInEditor: z.iso.datetime({ offset: true }),
    source: z.enum(SIDECAR_SOURCES),
  })
  .strict();

export type Sidecar = z.infer<typeof sidecarSchema>;

export type SidecarParse = { ok: true; value: Sidecar } | { ok: false; path: string; message: string };

/** Validates parsed JSON. On failure: the first issue's dotted path ("(root)" when top-level) + message. */
export function parseSidecar(json: unknown): SidecarParse {
  const r = sidecarSchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0]!;
  const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
  return { ok: false, path, message: issue.message };
}
