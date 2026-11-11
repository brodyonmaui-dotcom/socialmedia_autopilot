import { describe, expect, it } from "vitest";
import { findLocationTagKeys } from "../probe.js";

// Shapes follow `ffprobe -print_format json -show_format -show_streams`. Values are dummies.
describe("findLocationTagKeys", () => {
  it("iPhone: Apple's uppercase ISO6709 key in the container tags", () => {
    const iphone = {
      format: { tags: { major_brand: "qt  ", "com.apple.quicktime.location.ISO6709": "+00.0000+000.0000+000.000/", "com.apple.quicktime.make": "Apple", creation_time: "2026-11-09T18:00:00.000000Z" } },
      streams: [{ tags: { handler_name: "Core Media Video" } }, { tags: { handler_name: "Core Media Audio" } }],
    };
    expect(findLocationTagKeys(iphone)).toEqual(["com.apple.quicktime.location.ISO6709"]);
  });

  it("generic MP4 'location' / 'location-eng' (Android, ffmpeg-written)", () => {
    expect(findLocationTagKeys({ format: { tags: { location: "+00.0000+000.0000/", "location-eng": "+00.0000+000.0000/" } } }).sort()).toEqual(["location", "location-eng"]);
  });

  it("finds keys on any stream, not just the container or the video stream", () => {
    const onAudio = { format: { tags: {} }, streams: [{ tags: {} }, { tags: { "com.apple.quicktime.location.accuracy.horizontal": "5.0" } }] };
    expect(findLocationTagKeys(onAudio)).toHaveLength(1);
  });

  it("EXIF-style GPS keys, any case", () => {
    expect(findLocationTagKeys({ format: { tags: { GPS_Latitude: "0", "exif.gps_longitude": "0" } } })).toHaveLength(2);
  });

  it("clean files and stripped output have none (no false positives on ordinary tags)", () => {
    const clean = {
      format: { tags: { major_brand: "isom", minor_version: "512", compatible_brands: "isomiso2avc1mp41", encoder: "Lavf61.7.100" } },
      streams: [{ tags: { language: "und", handler_name: "VideoHandler", vendor_id: "[0][0][0][0]" } }],
    };
    expect(findLocationTagKeys(clean)).toEqual([]);
    expect(findLocationTagKeys({})).toEqual([]);
  });
});
