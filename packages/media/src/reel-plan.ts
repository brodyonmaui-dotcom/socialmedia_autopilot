/**
 * Reel maker plan (pure, import-free so the web app may deep-import it to validate the form with the
 * exact rules the worker applies: `@autopilot/media/src/reel-plan.js`). The ffmpeg side is reel.ts.
 */

export const REEL_LIMITS = {
  minDurationS: 3,
  maxDurationS: 90,
  minVolume: 0,
  maxVolume: 1.5,
  fadeInS: 0.5,
  fadeOutS: 1,
  /** Kill ffmpeg after this long. */
  timeoutMs: 15 * 60_000,
} as const;

/** "sound": the sound replaces the clip's audio; "mix": both; "original": the clip's own audio only. */
export type ReelAudio = "sound" | "mix" | "original";
export const REEL_AUDIO_MODES: readonly ReelAudio[] = ["sound", "mix", "original"];
export const isReelAudio = (v: unknown): v is ReelAudio => typeof v === "string" && (REEL_AUDIO_MODES as readonly string[]).includes(v);

/** Defaults when a volume is left out. In a mix the sound sits under the clip's own audio. */
export const REEL_DEFAULT_VOLUME = { sound: 1, mixSound: 0.5, original: 1 } as const;

export interface ReelInput {
  /** The source clip's length (seconds). */
  durationS: number;
  trimStartS?: number | null;
  trimEndS?: number | null;
  audio: ReelAudio;
  soundVolume?: number | null;
  originalVolume?: number | null;
  /** False when the source clip has no audio track (default true). */
  sourceHasAudio?: boolean;
}

export interface ReelPlan {
  /** Source-time range kept. */
  start: number;
  end: number;
  /** end − start. */
  durationS: number;
  audio: ReelAudio;
  /** A sound file is an input (sound or mix). */
  usesSound: boolean;
  /** The clip's own audio is in the output (original or mix, and the source has audio). */
  usesOriginal: boolean;
  soundVolume: number;
  originalVolume: number;
  /** Set when the plan must not run (plain words); runReel refuses it. */
  refusal: string | null;
}

/** The params a media_edits row stores (jsonb), as the web form sends them. */
export interface ReelParams {
  trimStartS: number | null;
  trimEndS: number | null;
  audio: ReelAudio;
  soundVolume: number | null;
  originalVolume: number | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Validates and resolves a reel request (pure). Never throws: problems come back as `refusal`. */
export function planReel(input: ReelInput): ReelPlan {
  const dur = isNum(input.durationS) && input.durationS > 0 ? input.durationS : 0;
  const start = isNum(input.trimStartS) ? input.trimStartS : 0;
  const end = isNum(input.trimEndS) ? Math.min(input.trimEndS, dur) : dur;
  const audio = input.audio;
  const hasAudio = input.sourceHasAudio !== false;
  const soundVolume = isNum(input.soundVolume) ? input.soundVolume : audio === "mix" ? REEL_DEFAULT_VOLUME.mixSound : REEL_DEFAULT_VOLUME.sound;
  const originalVolume = isNum(input.originalVolume) ? input.originalVolume : REEL_DEFAULT_VOLUME.original;
  const length = r3(end - start);

  let refusal: string | null = null;
  const inRange = (v: number) => v >= REEL_LIMITS.minVolume && v <= REEL_LIMITS.maxVolume;
  if (!isReelAudio(audio)) refusal = "Pick how the sound is used: sound only, mix, or the clip's own sound.";
  else if (dur <= 0) refusal = "This clip's length is unknown, so a reel can't be made from it.";
  else if (start < 0 || start >= dur) refusal = "The start time must be inside the clip.";
  else if (end <= start) refusal = "The end time must be after the start time.";
  else if (length < REEL_LIMITS.minDurationS) refusal = `A reel must be at least ${REEL_LIMITS.minDurationS} seconds long.`;
  else if (length > REEL_LIMITS.maxDurationS) refusal = `A reel can be at most ${REEL_LIMITS.maxDurationS} seconds long. Trim it shorter.`;
  else if (!inRange(soundVolume) || !inRange(originalVolume)) refusal = `Volumes go from ${REEL_LIMITS.minVolume} to ${REEL_LIMITS.maxVolume}.`;
  else if (audio === "original" && !hasAudio) refusal = "This clip has no sound of its own. Pick a sound.";

  const usesSound = audio === "sound" || audio === "mix";
  return {
    start: r3(Math.max(0, start)),
    end: r3(Math.max(0, end)),
    durationS: length,
    audio,
    usesSound,
    usesOriginal: hasAudio && (audio === "original" || audio === "mix"),
    soundVolume: r3(soundVolume),
    originalVolume: r3(originalVolume),
    refusal,
  };
}
