import { spawnSync } from "node:child_process";

/** True when ffmpeg and ffprobe run here. ffmpeg-backed tests skip (with one clear line) when they don't. */
export const HAS_FFMPEG = ["ffmpeg", "ffprobe"].every((b) => !spawnSync(b, ["-version"], { stdio: "ignore" }).error);

if (!HAS_FFMPEG) console.log("[media tests] ffmpeg/ffprobe not installed: skipping the ffmpeg-backed tests (install ffmpeg to run them)");
