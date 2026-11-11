import { run } from "./exec.js";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  hasAudio: boolean;
  hasLocationTags: boolean;
  /** When the camera recorded a capture timestamp. A date, not a place — fine to keep internally. */
  capturedAt?: string;
}

/**
 * Any tag key that can carry a place: "location", "location-eng", Apple's
 * "com.apple.quicktime.location.ISO6709" (uppercase on iPhones), Android/EXIF-style "gps_*".
 * Matched case-insensitively on the container AND every stream, so a key spelled differently by
 * another camera app still counts. touchUp strips all metadata regardless; this only drives the
 * QA warning (and the touch-up queue).
 */
const LOCATION_KEY = /location|iso6709|(^|[._-])gps/i;

export function findLocationTagKeys(ffprobeJson: { format?: { tags?: Record<string, unknown> }; streams?: Array<{ tags?: Record<string, unknown> }> }): string[] {
  const keys = [
    ...Object.keys(ffprobeJson.format?.tags ?? {}),
    ...(ffprobeJson.streams ?? []).flatMap((s) => Object.keys(s.tags ?? {})),
  ];
  return [...new Set(keys.filter((k) => LOCATION_KEY.test(k)))];
}

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
  const hasLocationTags = findLocationTagKeys(data).length > 0;

  const capturedAt = (allTags.creation_time as string | undefined) ?? undefined;

  return {
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: den ? num / den : 0,
    durationS: Number(data.format?.duration ?? video.duration ?? 0),
    hasAudio: !!audio,
    hasLocationTags,
    capturedAt,
  };
}
