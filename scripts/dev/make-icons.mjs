#!/usr/bin/env node
// node scripts/dev/make-icons.mjs: writes the PWA icons into apps/web/public/icons/ (F8).
// A plain monogram ("A" strokes, white on near-black), drawn from line segments: no photo, no font,
// no third-party art, no place. Deterministic, so re-running produces identical files.
// Everything is full-bleed (the OS rounds/masks it); the glyph sits inside the maskable 80% safe zone.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/icons");
const BG = [0x11, 0x11, 0x11];
const FG = [0xff, 0xff, 0xff];

// Unit-square segments [x1, y1, x2, y2] and the stroke half-width.
const SEGMENTS = [
  [0.5, 0.24, 0.29, 0.76],
  [0.5, 0.24, 0.71, 0.76],
  [0.37, 0.58, 0.63, 0.58],
];
const HALF_WIDTH = 0.045;

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 4×4 supersampled coverage of the glyph at pixel (x, y). */
function coverage(x, y, size) {
  let hit = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size;
      const py = (y + (sy + 0.5) / 4) / size;
      if (SEGMENTS.some((s) => distToSegment(px, py, s) <= HALF_WIDTH)) hit++;
    }
  }
  return hit / 16;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size);
      for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export const ICONS = { "icon-192.png": 192, "icon-512.png": 512, "icon-maskable-512.png": 512, "apple-touch-icon.png": 180 };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, size] of Object.entries(ICONS)) writeFileSync(join(OUT, name), png(size));
  console.log(`make-icons: ok (${Object.keys(ICONS).length} files in apps/web/public/icons)`);
}
