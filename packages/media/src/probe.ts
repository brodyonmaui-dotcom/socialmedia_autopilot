import { run } from "./exec.js";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  hasAudio: boolean;
  hasLocationTags: boolean;
}

/** Tag keys ffprobe surfaces for embedded GPS/location data across common container/codec combos. */
const LOCATION_TAG_KEYS = ["location", "location-eng", "com.apple.quicktime.location.iso6709", "gps_latitude", "gps_longitude"];

export async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams as Array<Record<string, unknown>>).find((s) => s.codec_type === "video");
  const audio = (data.streams as Array<Record<string, unknown>>).find((s) => s.codec_type === "audio");
  if (!video) throw new Error(`no video stream in ${filePath}`);

  const [num = 0, den = 1] = String(video.r_frame_rate ?? "0/1").split("/").map(Number);
  const allTags: Record<string, unknown> = {
    ...(data.format?.tags as Record<string, unknown> | undefined),
    ...(video.tags as Record<string, unknown> | undefined),
  };
  const hasLocationTags = LOCATION_TAG_KEYS.some((k) => k in allTags);

  return {
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: den ? num / den : 0,
    durationS: Number(data.format?.duration ?? video.duration ?? 0),
    hasAudio: !!audio,
    hasLocationTags,
  };
}
