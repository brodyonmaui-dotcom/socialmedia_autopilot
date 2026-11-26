// R2 (S3 API) access for the worker's media jobs and the web's sound upload. No ffmpeg / child_process here,
// so the web app may deep-import this file (`@autopilot/media/src/storage.js`). Never logs keys or bodies.
import { createReadStream, createWriteStream, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

/** The R2 operations the fix, recheck, reel and ingest jobs need. */
export interface MediaStorage {
  download(key: string, toPath: string): Promise<void>;
  upload(key: string, fromPath: string, contentType: string): Promise<void>;
}

/** Plus an in-memory put (the web's sound upload: the file arrives as bytes, never written to disk). */
export interface ByteStorage {
  putBytes(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/**
 * S3 multipart on R2 (F23 browser upload): the web server creates one multipart upload per file, sends each
 * browser chunk as a part, then completes or aborts it; the worker deletes the raw `incoming/` object after
 * processing. Part numbers are 1-based; every part but the last must be ≥ 5 MiB (S3/R2 rule).
 */
export interface MultipartStorage {
  /** Returns the S3 UploadId. */
  createMultipart(key: string, contentType: string): Promise<string>;
  /** Returns the part's ETag (needed by complete). */
  uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>;
  /** Drops the uploaded parts. A no-longer-existing upload is not an error. */
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Deletes one object. Deleting a missing key is not an error (S3 semantics). */
  deleteObject(key: string): Promise<void>;
}

const isNoSuchUpload = (err: unknown) => {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchUpload" || e?.Code === "NoSuchUpload" || e?.$metadata?.httpStatusCode === 404;
};

/** Same env names as the laptop ingest agent (tools/ingest-agent). Null when any is missing. */
export function r2StorageFromEnv(env: NodeJS.ProcessEnv): (MediaStorage & ByteStorage & MultipartStorage) | null {
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
    async createMultipart(key, contentType) {
      const res = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
      if (!res.UploadId) throw new Error("storage: no upload id");
      return res.UploadId;
    },
    async uploadPart(key, uploadId, partNumber, body) {
      const res = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.byteLength }));
      if (!res.ETag) throw new Error("storage: no part etag");
      return res.ETag;
    },
    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    },
    async abortMultipart(key, uploadId) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
      } catch (err) {
        if (!isNoSuchUpload(err)) throw err;
      }
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
