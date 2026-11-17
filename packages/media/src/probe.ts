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
  /** Format facts for the touch-up QA (v2). Optional so older stored results still type-check. */
  videoCodec?: string;
  audioCodec?: string;
  pixFmt?: string;
  /** ffprobe `format_name` ("mov,mp4,m4a,3gp,3g2,mj2" for both MOV and MP4). */
  container?: string;
  /** Display rotation in degrees (display matrix side data or the legacy `rotate` tag); 0 = none. */
  rotation?: number;
  /** Overall bitrate, bits per second (0 = unknown). */
  bitRate?: number;
  audioSampleRate?: number;
  /** Camera/phone make/model/software tags present (keys only matter, values are never kept). */
  hasDeviceTags?: boolean;
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

/** Device-identifying keys: make/model/software (Apple's com.apple.quicktime.*, Android's com.android.*). */
const DEVICE_KEY = /(^|[._-])(make|model|software)$|^com\.android\.(version|manufacturer|model|capture)/i;

export function findDeviceTagKeys(ffprobeJson: { format?: { tags?: Record<string, unknown> }; streams?: Array<{ tags?: Record<string, unknown> }> }): string[] {
  const keys = [
    ...Object.keys(ffprobeJson.format?.tags ?? {}),
    ...(ffprobeJson.streams ?? []).flatMap((s) => Object.keys(s.tags ?? {})),
  ];
  return [...new Set(keys.filter((k) => DEVICE_KEY.test(k)))];
}

/** Display rotation (degrees, normalised to 0/90/180/270) from the display matrix side data or the old `rotate` tag. */
export function rotationOf(video: Record<string, unknown>): number {
  const side = (video.side_data_list as Array<Record<string, unknown>> | undefined) ?? [];
  const fromSide = side.find((s) => typeof s.rotation === "number" || typeof s.rotation === "string")?.rotation;
  const raw = Number(fromSide ?? (video.tags as Record<string, unknown> | undefined)?.rotate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
}

async function ffprobeJson(filePath: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  return JSON.parse(stdout);
}

/** Post-strip verification (F7 C1): the location-capable tag keys still present in a file. Keys only, never values. */
export async function probeLocationTagKeys(filePath: string): Promise<string[]> {
  return findLocationTagKeys(await ffprobeJson(filePath));
}

export async function probe(filePath: string): Promise<ProbeResult> {
  const data = await ffprobeJson(filePath);
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
    videoCodec: video.codec_name ? String(video.codec_name) : undefined,
    audioCodec: audio?.codec_name ? String(audio.codec_name) : undefined,
    pixFmt: video.pix_fmt ? String(video.pix_fmt) : undefined,
    container: data.format?.format_name ? String(data.format.format_name) : undefined,
    rotation: rotationOf(video),
    bitRate: Number(data.format?.bit_rate ?? 0) || 0,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    hasDeviceTags: findDeviceTagKeys(data).length > 0,
  };
}
