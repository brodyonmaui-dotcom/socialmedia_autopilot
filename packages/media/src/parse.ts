export interface BlackSegment {
  start: number;
  end: number;
}

/** Parses ffmpeg's `blackdetect` filter output (stderr lines like `black_start:1.2 black_end:3.4 black_duration:2.2`). */
export function parseBlackSegments(stderr: string): BlackSegment[] {
  const out: BlackSegment[] = [];
  const re = /black_start:([\d.]+) black_end:([\d.]+)/g;
  for (const m of stderr.matchAll(re)) out.push({ start: Number(m[1]), end: Number(m[2]) });
  return out;
}

/** Parses ffmpeg's `freezedetect` filter output (stderr lines like `freeze_start: 1.2` / `freeze_end: 3.4`). */
export function parseFreezeSegments(stderr: string, durationS?: number): BlackSegment[] {
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  // A freeze that lasts to the end of the clip has no freeze_end line: it ends at the duration (when known).
  return starts.map((start, i) => ({ start, end: ends[i] ?? (durationS && durationS > start ? durationS : start) }));
}

/** Parses `silencedetect` output (`silence_start: 1.2` / `silence_end: 3.4 | silence_duration: 2.2`); an open silence ends at the duration. */
export function parseSilenceSegments(stderr: string, durationS?: number): BlackSegment[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? (durationS && durationS > start ? durationS : start) }));
}

/** `pts_time:` of every frame `showinfo` printed (after `mpdecimate`: the frames that changed), in order. */
export function parseShowinfoPts(stderr: string): number[] {
  return [...stderr.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)/g)].map((m) => Number(m[1]));
}

export interface LoudnormMeasurement {
  inputIntegrated: number;
  inputTruePeak: number;
  inputLra: number;
  inputThreshold: number;
  targetOffset: number;
}

/** Parses the single-pass `loudnorm=print_format=json` measurement block ffmpeg prints to stderr. */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | undefined {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    const json = JSON.parse(stderr.slice(start, end + 1));
    return {
      inputIntegrated: Number(json.input_i),
      inputTruePeak: Number(json.input_tp),
      inputLra: Number(json.input_lra),
      inputThreshold: Number(json.input_thresh),
      targetOffset: Number(json.target_offset),
    };
  } catch {
    return undefined;
  }
}
