/**
 * Studio edit decision list (F24, docs/design/F24.md). Pure and import-free on purpose, like reel-plan.ts: the web
 * app (server action AND the browser editor) deep-imports `@autopilot/media/src/edl.js` to validate with the exact
 * rules the worker applies. The ffmpeg runner (`runEdl`) lives in edl-run.ts so this file never pulls in node:*.
 *
 * `edlArgs` builds the whole ffmpeg encode as an argv array (never a shell string): user text only ever reaches
 * ffmpeg as one escaped drawtext option value, with `expansion=none` so `%` sequences are not expanded.
 */

export const EDL_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type EdlSpeed = (typeof EDL_SPEEDS)[number];
export const EDL_POSITIONS = ["top", "center", "bottom"] as const;
export const EDL_STYLES = ["bold", "plain"] as const;

export interface EdlClip {
  mediaId: string;
  inS: number;
  outS: number;
  speed: EdlSpeed;
}
export interface EdlText {
  text: string;
  startS: number;
  endS: number;
  position: "top" | "center" | "bottom";
  style: "bold" | "plain";
}
export interface EdlSound {
  soundId: string;
  offsetS: number;
  volume: number;
}
export interface Edl {
  v: 1;
  /** 1080x1920: fill = crop to cover, fit = blurred pad (fix.ts padFilters). */
  fit: "fill" | "fit";
  clips: EdlClip[];
  /** Times on the output timeline. */
  texts: EdlText[];
  /** Starts at output 0; the sound is read from offsetS (looped when shorter than the edit). */
  sound: EdlSound | null;
  originalVolume: number;
  /** Poster frame on the output timeline. */
  coverS: number | null;
}

export const EDL_LIMITS = {
  minDurationS: 3,
  maxDurationS: 90,
  maxClips: 10,
  maxTexts: 10,
  maxTextChars: 80,
  /** Shortest piece of a clip on the output timeline (a split can't leave a zero-frame sliver). */
  minPieceS: 0.1,
  minVolume: 0,
  maxVolume: 1.5,
  fadeInS: 0.3,
  fadeOutS: 1,
  width: 1080,
  height: 1920,
  fps: 30,
  /** Safe text margins (share of the height): clear of Instagram's top bar and bottom caption/buttons. */
  topMargin: 0.12,
  bottomMargin: 0.22,
  /** Kill ffmpeg after this long. */
  timeoutMs: 20 * 60_000,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inVol = (n: unknown): n is number => isNum(n) && n >= EDL_LIMITS.minVolume && n <= EDL_LIMITS.maxVolume;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** Σ (outS − inS) / speed, rounded to the millisecond. */
export function outputDuration(edl: Pick<Edl, "clips">): number {
  return r3(edl.clips.reduce((n, c) => n + pieceDuration(c), 0));
}
const pieceDuration = (c: Pick<EdlClip, "inS" | "outS" | "speed">) => r3((c.outS - c.inS) / c.speed);

/**
 * Validates an EDL (an object, or its JSON text). Never throws. On success the EDL is normalised: only the known
 * keys, numbers rounded to the millisecond, text trimmed with `\r\n` folded to `\n`.
 */
export function parseEdl(raw: unknown): { ok: true; edl: Edl } | { ok: false; error: string } {
  const no = (error: string) => ({ ok: false as const, error });
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return no("The edit couldn't be read. Reload Studio and try again.");
    }
  }
  if (!isObj(v) || v.v !== 1) return no("The edit couldn't be read. Reload Studio and try again.");
  if (v.fit !== "fill" && v.fit !== "fit") return no("Pick Fit or Fill.");

  if (!Array.isArray(v.clips) || v.clips.length === 0) return no("Add at least one clip.");
  if (v.clips.length > EDL_LIMITS.maxClips) return no(`Use at most ${EDL_LIMITS.maxClips} clips.`);
  const clips: EdlClip[] = [];
  for (const [i, c] of v.clips.entries()) {
    const n = i + 1;
    if (!isObj(c) || typeof c.mediaId !== "string" || !UUID.test(c.mediaId)) return no(`Clip ${n} isn't a library clip.`);
    if (!isNum(c.inS) || !isNum(c.outS) || c.inS < 0) return no(`Clip ${n}: the in and out points must be plain numbers.`);
    if (c.outS <= c.inS) return no(`Clip ${n}: the out point must be after the in point.`);
    if (!(EDL_SPEEDS as readonly unknown[]).includes(c.speed)) return no(`Clip ${n}: pick a speed from the menu.`);
    const clip: EdlClip = { mediaId: c.mediaId.toLowerCase(), inS: r3(c.inS), outS: r3(c.outS), speed: c.speed as EdlSpeed };
    if (pieceDuration(clip) < EDL_LIMITS.minPieceS) return no(`Clip ${n} is too short. Make it longer or delete it.`);
    clips.push(clip);
  }
  const total = outputDuration({ clips });
  if (total < EDL_LIMITS.minDurationS) return no(`The video must be at least ${EDL_LIMITS.minDurationS} seconds long.`);
  if (total > EDL_LIMITS.maxDurationS) return no(`The video can be at most ${EDL_LIMITS.maxDurationS} seconds long. Trim it shorter.`);

  const rawTexts = v.texts ?? [];
  if (!Array.isArray(rawTexts)) return no("The text overlays couldn't be read.");
  if (rawTexts.length > EDL_LIMITS.maxTexts) return no(`Use at most ${EDL_LIMITS.maxTexts} text overlays.`);
  const texts: EdlText[] = [];
  for (const [i, t] of rawTexts.entries()) {
    const n = i + 1;
    if (!isObj(t) || typeof t.text !== "string") return no(`Text ${n} couldn't be read.`);
    const text = t.text.replace(/\r\n?/g, "\n").trim();
    if (!text) return no(`Text ${n} is empty. Type something or delete it.`);
    if ([...text].length > EDL_LIMITS.maxTextChars) return no(`Text ${n} is over ${EDL_LIMITS.maxTextChars} characters.`);
    if (CONTROL.test(text)) return no(`Text ${n} has characters that can't be drawn.`);
    if (!isNum(t.startS) || !isNum(t.endS) || t.startS < 0) return no(`Text ${n}: the start and end must be plain numbers.`);
    if (t.endS <= t.startS) return no(`Text ${n}: the end must be after the start.`);
    if (t.startS >= total) return no(`Text ${n} starts after the video ends.`);
    if (!(EDL_POSITIONS as readonly unknown[]).includes(t.position)) return no(`Text ${n}: pick top, center or bottom.`);
    if (!(EDL_STYLES as readonly unknown[]).includes(t.style)) return no(`Text ${n}: pick bold or plain.`);
    texts.push({ text, startS: r3(t.startS), endS: r3(Math.min(t.endS, total)), position: t.position as EdlText["position"], style: t.style as EdlText["style"] });
  }

  let sound: EdlSound | null = null;
  if (v.sound != null) {
    const s = v.sound;
    if (!isObj(s) || typeof s.soundId !== "string" || !UUID.test(s.soundId)) return no("Pick a sound from Sounds (or none).");
    if (!isNum(s.offsetS) || s.offsetS < 0) return no("The sound start must be a plain number.");
    if (!inVol(s.volume)) return no(`Volumes go from ${EDL_LIMITS.minVolume} to ${EDL_LIMITS.maxVolume}.`);
    sound = { soundId: s.soundId.toLowerCase(), offsetS: r3(s.offsetS), volume: r3(s.volume) };
  }
  if (!inVol(v.originalVolume)) return no(`Volumes go from ${EDL_LIMITS.minVolume} to ${EDL_LIMITS.maxVolume}.`);

  let coverS: number | null = null;
  if (v.coverS != null) {
    if (!isNum(v.coverS) || v.coverS < 0 || v.coverS >= total) return no("The cover frame must be inside the video.");
    coverS = r3(v.coverS);
  }
  return { ok: true, edl: { v: 1, fit: v.fit, clips, texts, sound, originalVolume: r3(v.originalVolume), coverS } };
}

// ---------- ffmpeg args (pure) ----------

const f = (n: number) => String(r3(n));
const AFMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const LUFS = { I: -14, TP: -1.5, LRA: 11 } as const;
/** Same container/codec output as fix.ts ENCODE_ARGS (kept literal here so this file stays import-free). */
const META = ["-map_metadata", "-1", "-map_chapters", "-1"];
const AAC = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];
const X264 = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"];

/** Loudnorm pass-1 numbers (parse.ts LoudnormMeasurement, same shape). */
export interface EdlLoudness {
  inputIntegrated: number;
  inputTruePeak: number;
  inputLra: number;
  inputThreshold: number;
  targetOffset: number;
}

export interface EdlInputs {
  /** One path per clip, in EDL order (the same file may repeat: it's downloaded once, read per clip). */
  clipPaths: string[];
  soundPath?: string;
  /** TTF for "bold" texts (and "plain" ones when plainFontPath is absent). */
  fontPath: string;
  plainFontPath?: string;
  outPath: string;
  /** Per clip: does the file have an audio track? Default true. A clip without one gets silence (anullsrc). */
  clipHasAudio?: boolean[];
}

export interface EdlArgsOptions {
  /** Pass-2 loudnorm with these numbers; null = leave loudness as it is (silent audio); absent = one-pass loudnorm. */
  measured?: EdlLoudness | null;
}

/**
 * Escapes a value for a drawtext option inside -filter_complex. Level 1 (option parser): wrapped in single quotes,
 * a `'` becomes `'\''`. Level 2 (graph parser): every `\ ' [ ] , ;` gets a backslash. `%` needs nothing because
 * the filter runs with expansion=none; `:` is inside the quotes. Newlines never get here: texts are wrapped into one drawtext per line.
 */
export function escapeDrawtext(s: string): string {
  const quoted = `'${s.replace(/'/g, `'\\''`)}'`;
  return quoted.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/** The 1080x1920 fit for one clip, labels suffixed with the clip index (fix.ts padFilters for "fit"). */
function fitFilters(i: number, v: string, fit: Edl["fit"]): string[] {
  const W = EDL_LIMITS.width;
  const H = EDL_LIMITS.height;
  if (fit === "fill") return [`${v}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p[v${i}]`];
  // Same graph as fix.ts padFilters (blurred, cropped copy behind the scaled clip), per-clip labels.
  return [
    `${v}split[v_fg${i}][v_bg${i}]`,
    `[v_bg${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[v_blur${i}]`,
    `[v_fg${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[v_top${i}]`,
    `[v_blur${i}][v_top${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v${i}]`,
  ];
}

/** Characters per line before a text wraps (drawtext never wraps by itself). */
export const EDL_WRAP_CHARS = 20;

/** Word-wraps a text overlay (explicit newlines kept; a word longer than a line is broken). Pure. */
export function wrapText(text: string, max: number = EDL_WRAP_CHARS): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while ([...word].length > max) {
        if (line) out.push(line);
        line = "";
        out.push([...word].slice(0, max).join(""));
        word = [...word].slice(max).join("");
      }
      if (!word) continue;
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= max) line = `${line} ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * One drawtext per wrapped line, each centred horizontally; the block sits inside the safe margins (top 12%,
 * bottom 22%) or centred. The font size shrinks when the longest line wouldn't fit 90% of the width.
 */
function drawtexts(t: EdlText, fontPath: string): string[] {
  const W = EDL_LIMITS.width;
  const H = EDL_LIMITS.height;
  const lines = wrapText(t.text);
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const size = Math.min(t.style === "bold" ? 76 : 64, Math.floor((W * 0.9) / (longest * 0.62)));
  const lineH = Math.round(size * 1.3);
  const blockH = lines.length * lineH;
  const top = t.position === "top" ? H * EDL_LIMITS.topMargin : t.position === "center" ? (H - blockH) / 2 : H * (1 - EDL_LIMITS.bottomMargin) - blockH;
  const look = t.style === "bold" ? "box=1:boxcolor=black@0.45:boxborderw=14" : "shadowcolor=black@0.6:shadowx=3:shadowy=3";
  const when = `enable='between(t,${f(t.startS)},${f(t.endS)})'`;
  return lines.map(
    (line, k) =>
      `drawtext=fontfile=${escapeDrawtext(fontPath)}:expansion=none:text=${escapeDrawtext(line)}` +
      `:fontcolor=white:fontsize=${size}:${look}:x=(w-text_w)/2:y=${Math.round(top + k * lineH)}:${when}`,
  );
}

/** The whole graph up to `[v_out]` and `[a_mix]` (pure). */
export function edlGraph(edl: Edl, inputs: Omit<EdlInputs, "outPath">): { video: string[]; audio: string[]; durationS: number } {
  const n = edl.clips.length;
  if (inputs.clipPaths.length !== n) throw new Error("edlArgs: one clip path per clip");
  if (edl.sound && !inputs.soundPath) throw new Error("edlArgs: this edit needs a sound file");
  const D = outputDuration(edl);
  const video: string[] = [];
  const audio: string[] = [];
  edl.clips.forEach((c, i) => {
    const d = pieceDuration(c);
    const pts = c.speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${c.speed}`;
    video.push(...fitFilters(i, `[${i}:v:0]trim=start=${f(c.inS)}:end=${f(c.outS)},setpts=${pts},fps=${EDL_LIMITS.fps},`, edl.fit));
    // atempo accepts 0.5..100, so every menu speed is one filter (0.5 included).
    const tempo = c.speed === 1 ? "" : `atempo=${c.speed},`;
    const src =
      inputs.clipHasAudio?.[i] === false
        ? `anullsrc=channel_layout=stereo:sample_rate=48000,${AFMT}`
        : `[${i}:a:0]atrim=start=${f(c.inS)}:end=${f(c.outS)},asetpts=PTS-STARTPTS,${tempo}${AFMT}`;
    audio.push(`${src},apad=whole_dur=${f(d)},atrim=end=${f(d)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const pairs = edl.clips.map((_, i) => `[v${i}][a${i}]`).join("");
  const plain = inputs.plainFontPath ?? inputs.fontPath;
  const texts = edl.texts.flatMap((t) => drawtexts(t, t.style === "bold" ? inputs.fontPath : plain));
  video.push(`${pairs}concat=n=${n}:v=1:a=1[v_cat][a_cat]`, `[v_cat]${texts.length ? texts.join(",") : "null"}[v_out]`);

  audio.push(`[a_cat]volume=${f(edl.originalVolume)}[a_orig]`);
  if (edl.sound) {
    const s = edl.sound;
    const fadeOutAt = Math.max(0, D - EDL_LIMITS.fadeOutS);
    audio.push(
      `[${n}:a:0]atrim=start=${f(s.offsetS)}:end=${f(s.offsetS + D)},asetpts=PTS-STARTPTS,${AFMT},volume=${f(s.volume)},` +
        `afade=t=in:st=0:d=${f(EDL_LIMITS.fadeInS)},afade=t=out:st=${f(fadeOutAt)}:d=${f(EDL_LIMITS.fadeOutS)}[a_snd]`,
      `[a_orig][a_snd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_mix]`,
    );
  } else {
    audio.push(`[a_orig]anull[a_mix]`);
  }
  return { video, audio, durationS: D };
}

/** `-i` per clip, then the sound looped (`-stream_loop -1`; atrim cuts it to length). */
function inputArgs(edl: Edl, inputs: Omit<EdlInputs, "outPath">): string[] {
  return [...inputs.clipPaths.flatMap((p) => ["-i", p]), ...(edl.sound ? ["-stream_loop", "-1", "-i", inputs.soundPath!] : [])];
}

const loudnormOnePass = () => `loudnorm=I=${LUFS.I}:TP=${LUFS.TP}:LRA=${LUFS.LRA}`;
const loudnormApply = (m: EdlLoudness) => {
  const g = (n: number) => (Number.isFinite(n) ? String(n) : "0");
  return (
    `loudnorm=I=${LUFS.I}:TP=${LUFS.TP}:LRA=${LUFS.LRA}:measured_I=${g(m.inputIntegrated)}:measured_TP=${g(m.inputTruePeak)}` +
    `:measured_LRA=${g(m.inputLra)}:measured_thresh=${g(m.inputThreshold)}:offset=${g(m.targetOffset)}:linear=true:print_format=summary`
  );
};

/** Loudnorm pass 1 (pure): measures the final mixed audio; video is not decoded. */
export function edlLoudnessArgs(edl: Edl, inputs: Omit<EdlInputs, "outPath">): string[] {
  const { audio } = edlGraph(edl, inputs);
  return [
    "-hide_banner",
    "-nostats",
    ...inputArgs(edl, inputs),
    "-filter_complex",
    [...audio, `[a_mix]loudnorm=I=${LUFS.I}:TP=${LUFS.TP}:LRA=${LUFS.LRA}:print_format=json[a_m]`].join(";"),
    "-map",
    "[a_m]",
    "-f",
    "null",
    "-",
  ];
}

/**
 * The encode (pure): per clip trim + setpts/atempo + 1080x1920 at 30 fps → concat → drawtext windows → original ×
 * originalVolume amix sound × volume (faded) → loudnorm → H.264/AAC. `-t` bounds the output (the looped sound is
 * infinite). All metadata and chapters dropped.
 */
export function edlArgs(edl: Edl, inputs: EdlInputs, opts: EdlArgsOptions = {}): string[] {
  const { video, audio, durationS } = edlGraph(edl, inputs);
  const norm = opts.measured === null ? "" : opts.measured ? `${loudnormApply(opts.measured)},` : `${loudnormOnePass()},`;
  return [
    "-hide_banner",
    "-nostats",
    ...inputArgs(edl, inputs),
    "-filter_complex",
    [...video, ...audio, `[a_mix]${norm}aresample=48000[a_out]`].join(";"),
    "-map",
    "[v_out]",
    "-map",
    "[a_out]",
    ...AAC,
    ...X264,
    "-r",
    String(EDL_LIMITS.fps),
    "-t",
    f(durationS),
    "-sn",
    "-dn",
    ...META,
    "-movflags",
    "+faststart",
    "-y",
    inputs.outPath,
  ];
}
