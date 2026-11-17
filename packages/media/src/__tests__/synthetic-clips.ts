import { join } from "node:path";
import { runChecked } from "../exec.js";

/**
 * Small synthetic clips (ffmpeg lavfi only; no real footage, no metadata). 540×960 = 9:16 so they're fast.
 * Each one models a real-world case the old QA mis-flagged, or one defect the new QA must catch.
 */
const S = "540x960";

/** Static background with mild sensor noise + a small region moving (a person talking). */
const talkingVideo = (d: number) => [
  "-f", "lavfi", "-i", `color=c=0x606060:s=${S}:r=30:d=${d},noise=alls=6:allf=t`,
  "-f", "lavfi", "-i", `color=c=0xa08070:s=120x120:r=30:d=${d}`,
];
const talkingOverlay = "[0:v][1:v]overlay=x='200+60*sin(t*3)':y=300";
/** Speech-level tone bursts (0.9 s on, 0.3 s off), about −15 LUFS. */
const speech = (d: number, gain = 2.5) => ["-f", "lavfi", "-i", `sine=f=220:d=${d}:sample_rate=48000,volume='if(lt(mod(t,1.2),0.9),1,0)':eval=frame,volume=${gain}`];

const h264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
const aac = ["-c:a", "aac", "-ar", "48000"];

async function ff(args: string[]): Promise<void> {
  const r = await runChecked("ffmpeg", ["-v", "error", "-y", ...args], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`synthetic clip failed: ${r.stderr.slice(-400)}`);
}

export type ClipName =
  | "talking-head"
  | "gym-set"
  | "music-later"
  | "screen-recording"
  | "frozen-tail-3s"
  | "black-head-1s"
  | "quiet-30lufs"
  | "hevc"
  | "rotation"
  | "four-five"
  | "location-tag"
  | "speech-gaps";

export async function makeClip(dir: string, name: ClipName): Promise<string> {
  const out = join(dir, `${name}.mp4`);
  const d = 8;
  switch (name) {
    case "talking-head":
      await ff([...talkingVideo(d), ...speech(d), "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-map", "2:a", ...h264, ...aac, "-shortest", out]);
      break;
    case "gym-set":
      // Tripod gym set: a big shape moving up and down every 2.5 s, music-level audio.
      await ff([
        "-f", "lavfi", "-i", `color=c=0x404850:s=${S}:r=30:d=${d},noise=alls=3:allf=t`,
        "-f", "lavfi", "-i", `color=c=0xc0c0c0:s=160x260:r=30:d=${d}`,
        "-f", "lavfi", "-i", `sine=f=330:d=${d}:sample_rate=48000,volume=2.2`,
        "-filter_complex", "[0:v][1:v]overlay=x=190:y='350+250*sin(2*PI*t/2.5)'[v]",
        "-map", "[v]", "-map", "2:a", ...h264, ...aac, "-shortest", out,
      ]);
      break;
    case "music-later":
      // Filmed with the sound off (music gets added in the app): a silent audio track.
      await ff([...talkingVideo(d), "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-map", "2:a", "-t", String(d), ...h264, ...aac, out]);
      break;
    case "screen-recording":
      // Very static UI (no sensor noise at all), only the cursor moves.
      await ff([
        "-f", "lavfi", "-i", `color=c=white:s=${S}:r=30:d=${d}`,
        "-f", "lavfi", "-i", `color=c=0x3050a0:s=540x120:r=30:d=${d}`,
        "-f", "lavfi", "-i", `color=c=black:s=14x20:r=30:d=${d}`,
        "-filter_complex", "[0:v][1:v]overlay=0:0[ui];[ui][2:v]overlay=x='100+300*t/8':y='500+60*sin(t)'[v]",
        "-map", "[v]", ...h264, out,
      ]);
      break;
    case "frozen-tail-3s":
      await ff([...talkingVideo(9), "-filter_complex", `${talkingOverlay},tpad=stop_mode=clone:stop_duration=3[v]`, "-map", "[v]", ...h264, out]);
      break;
    case "black-head-1s":
      await ff([...talkingVideo(7), "-filter_complex", `${talkingOverlay},tpad=start_mode=add:start_duration=1:color=black[v]`, "-map", "[v]", ...h264, out]);
      break;
    case "quiet-30lufs":
      await ff([...talkingVideo(d), "-f", "lavfi", "-i", `sine=f=220:d=${d}:sample_rate=48000,volume=0.4`, "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-map", "2:a", ...h264, ...aac, "-shortest", out]);
      break;
    case "hevc":
      await ff([...talkingVideo(d), "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", out]);
      break;
    case "four-five":
      // 4:5 (feed crop) source: pad-fixable.
      await ff([
        "-f", "lavfi", "-i", "color=c=0x606060:s=544x680:r=30:d=6,noise=alls=6:allf=t",
        "-f", "lavfi", "-i", "color=c=0xa08070:s=120x120:r=30:d=6",
        "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", ...h264, out,
      ]);
      break;
    case "location-tag":
      // Dummy coordinates (0,0): the strip must remove the tag.
      await ff([...talkingVideo(4), ...speech(4), "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-map", "2:a", "-metadata", "location=+00.0000+000.0000/", "-metadata", "make=DemoPhone", ...h264, ...aac, "-shortest", out]);
      break;
    case "speech-gaps":
      // Speech-level audio with one 2.5 s silent pause in the middle (3–5.5 s).
      await ff([...talkingVideo(d), "-f", "lavfi", "-i", `sine=f=220:d=${d}:sample_rate=48000,volume='if(between(t,3,5.5),0,2.5)':eval=frame`, "-filter_complex", `${talkingOverlay}[v]`, "-map", "[v]", "-map", "2:a", ...h264, ...aac, "-shortest", out]);
      break;
    case "rotation": {
      // Stored landscape (960×540) with a 90° display flag: shows as a normal 9:16 clip.
      const flat = join(dir, "rotation-flat.mp4");
      await ff([
        "-f", "lavfi", "-i", `color=c=0x606060:s=960x540:r=30:d=${d},noise=alls=6:allf=t`,
        "-f", "lavfi", "-i", `color=c=0xa08070:s=120x120:r=30:d=${d}`,
        "-filter_complex", "[0:v][1:v]overlay=x='300+60*sin(t*3)':y=200[v]", "-map", "[v]", ...h264, flat,
      ]);
      await ff(["-display_rotation", "90", "-i", flat, "-c", "copy", out]);
      break;
    }
  }
  return out;
}
