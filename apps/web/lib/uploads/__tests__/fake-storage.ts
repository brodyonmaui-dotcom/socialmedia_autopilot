// In-memory R2 for the upload tests (web routes + the worker's media-ingest). Multipart semantics as S3:
// parts by number, complete concatenates in order, abort drops the parts, delete of a missing key is fine.
import { readFileSync, writeFileSync } from "node:fs";
import type { MediaStorage, MultipartStorage } from "@autopilot/media/src/storage.js";

export interface FakeStorage extends MediaStorage, MultipartStorage {
  objects: Map<string, Uint8Array>;
  open: Map<string, { key: string; parts: Map<number, Uint8Array> }>;
  calls: string[];
  /** Make the next call of this op throw. */
  failNext: Set<string>;
}

export function fakeStorage(): FakeStorage {
  let seq = 0;
  const s: FakeStorage = {
    objects: new Map(),
    open: new Map(),
    calls: [],
    failNext: new Set(),
    async createMultipart(key) {
      hit("create");
      const id = `mpu-${++seq}`;
      s.open.set(id, { key, parts: new Map() });
      return id;
    },
    async uploadPart(key, uploadId, n, body) {
      hit("part");
      const u = s.open.get(uploadId);
      if (!u || u.key !== key) throw Object.assign(new Error("no such upload"), { name: "NoSuchUpload" });
      u.parts.set(n, new Uint8Array(body));
      return `"etag-${uploadId}-${n}"`;
    },
    async completeMultipart(key, uploadId, parts) {
      hit("complete");
      const u = s.open.get(uploadId);
      if (!u || u.key !== key) throw Object.assign(new Error("no such upload"), { name: "NoSuchUpload" });
      const chunks = parts.map((p) => {
        const b = u.parts.get(p.partNumber);
        if (!b || p.etag !== `"etag-${uploadId}-${p.partNumber}"`) throw new Error("bad part");
        return b;
      });
      s.objects.set(key, Buffer.concat(chunks));
      s.open.delete(uploadId);
    },
    async abortMultipart(key, uploadId) {
      hit("abort");
      s.open.delete(uploadId);
      void key;
    },
    async deleteObject(key) {
      hit("delete");
      s.objects.delete(key);
    },
    async download(key, toPath) {
      hit("download");
      const b = s.objects.get(key);
      if (!b) throw new Error("no such object");
      writeFileSync(toPath, b);
    },
    async upload(key, fromPath) {
      hit("upload");
      s.objects.set(key, readFileSync(fromPath));
    },
  };
  function hit(op: string) {
    s.calls.push(op);
    if (s.failNext.delete(op)) throw new Error(`fake ${op} failure`);
  }
  return s;
}
