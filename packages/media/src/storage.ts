// R2 (S3 API) access for the worker's media jobs and the web's sound upload. No ffmpeg / child_process here,
// so the web app may deep-import this file (`@autopilot/media/src/storage.js`). Never logs keys or bodies.
import { createReadStream, createWriteStream, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** The R2 operations the fix, recheck and reel jobs need. */
export interface MediaStorage {
  download(key: string, toPath: string): Promise<void>;
  upload(key: string, fromPath: string, contentType: string): Promise<void>;
}

/** Plus an in-memory put (the web's sound upload: the file arrives as bytes, never written to disk). */
export interface ByteStorage {
  putBytes(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/** Same env names as the laptop ingest agent (tools/ingest-agent). Null when any is missing. */
export function r2StorageFromEnv(env: NodeJS.ProcessEnv): (MediaStorage & ByteStorage) | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET_MEDIA?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const client = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  return {
    async download(key, toPath) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error("storage: empty object");
      await pipeline(res.Body as Readable, createWriteStream(toPath));
    },
    async upload(key, fromPath, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(fromPath), ContentLength: statSync(fromPath).size, ContentType: contentType }));
    },
    async putBytes(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.byteLength, ContentType: contentType }));
    },
  };
}
