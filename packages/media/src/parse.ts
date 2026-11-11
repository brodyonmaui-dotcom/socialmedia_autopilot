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
export function parseFreezeSegments(stderr: string): BlackSegment[] {
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? start }));
}

export interface LoudnormMeasurement {
  inputIntegrated: number;
  inputTruePeak: number;
  inputLra: number;
  inputThreshold: number;
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
    };
  } catch {
    return undefined;
  }
}
