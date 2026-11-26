// Browser upload data layer (F23, server only). One `uploads` row per file: start (S3 multipart created under the
// private incoming/<id>.<ext> key) → parts (each ≤ 8 MiB, sent straight on to R2) → complete ('uploaded', the
// worker's media-ingest picks it up) or abort. Storage and DB are injected so the rules are testable with a fake
// storage. Never logs or returns keys, upload ids or upstream bodies; errors are fixed plain words.
import { randomUUID } from "node:crypto";
import type { MultipartStorage } from "@autopilot/media/src/storage.js";
import { baseName, checkPartSize, checkUploadFile, folderFromRelPath, incomingKey, isUuid, MAX_BATCH_FILES, PART_SIZE, partCount } from "./validate.js";

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export type UploadStatus = "uploading" | "uploaded" | "processing" | "done" | "duplicate" | "failed" | "aborted";

/** Stored per part in uploads.parts (jsonb). */
export interface StoredPart {
  n: number;
  etag: string;
  size: number;
}

export type Refusal = { ok: false; status: 400 | 404 | 409 | 413 | 502 | 503; error: string };

export const STORAGE_OFF = "Storage (R2) isn't set up on the server, so uploads are off.";
const STORAGE_FAILED = "Storage didn't accept that. Try again.";
const NOT_FOUND: Refusal = { ok: false, status: 404, error: "No such upload." };
/** Refuse a new upload while this many are still open (a runaway client, not the 200-file batch). */
export const MAX_OPEN_UPLOADS = 400;

const refuse = (status: Refusal["status"], error: string): Refusal => ({ ok: false, status, error });
const label = (err: unknown) => (err as Error)?.name ?? "error";

/** "Already in?" before uploading: same basename + size in a done/duplicate upload. Input order kept. */
export async function checkUploads(db: Queryable, files: Array<{ name: string; size: number }>): Promise<Array<{ name: string; size: number; already: boolean; mediaId?: string }>> {
  if (!Array.isArray(files)) throw new Error("files must be a list");
  if (files.length > MAX_BATCH_FILES) throw new Error(`at most ${MAX_BATCH_FILES} files per batch`);
  const asked = files.map((f) => ({ base: typeof f?.name === "string" ? baseName(f.name) : "", size: typeof f?.size === "number" && Number.isSafeInteger(f.size) && f.size >= 0 ? f.size : -1 }));
  const valid = asked.filter((f) => f.base && f.size >= 0);
  const found = new Map<string, string | null>();
  if (valid.length) {
    const { rows } = await db.query(
      `select distinct on (u.original_name, u.size_bytes) u.original_name, u.size_bytes::text as size, u.media_id
         from uploads u
         join unnest($1::text[], $2::bigint[]) as q(name, size) on q.name = u.original_name and q.size = u.size_bytes
        where u.status in ('done','duplicate')
        order by u.original_name, u.size_bytes, u.finished_at desc nulls last`,
      [valid.map((f) => f.base), valid.map((f) => f.size)],
    );
    for (const r of rows as Array<{ original_name: string; size: string; media_id: string | null }>) found.set(`${r.original_name}\u0000${r.size}`, r.media_id);
  }
  return files.map((f, i) => {
    const key = `${asked[i]!.base}\u0000${asked[i]!.size}`;
    const out = { name: f?.name, size: f?.size };
    if (!found.has(key)) return { ...out, already: false };
    const mediaId = found.get(key);
    return mediaId ? { ...out, already: true, mediaId } : { ...out, already: true };
  });
}

export type StartResult = { ok: true; uploadId: string; partSize: number } | { ok: false; error: string };

/** Validates the file, creates the R2 multipart upload and the row ('uploading'). Only the basename is stored. */
export async function startUpload(db: Queryable, storage: MultipartStorage | null, f: { name?: unknown; size?: unknown; type?: unknown; relPath?: unknown }, log: (l: string) => void = console.error): Promise<StartResult> {
  const check = checkUploadFile({ name: f?.name, size: f?.size, type: f?.type });
  if (!check.ok) return { ok: false, error: check.error };
  if (!storage) return { ok: false, error: STORAGE_OFF };
  const open = Number((await db.query("select count(*)::int as n from uploads where status = 'uploading'")).rows[0]?.n ?? 0);
  if (open >= MAX_OPEN_UPLOADS) return { ok: false, error: "Too many uploads are still open. Let them finish or cancel some first." };
  const folder = folderFromRelPath(typeof f.relPath === "string" ? f.relPath : null);
  const id = randomUUID();
  const key = incomingKey(id, check.ext);
  let s3UploadId: string;
  try {
    s3UploadId = await storage.createMultipart(key, check.contentType ?? "application/octet-stream");
  } catch (err) {
    log(`upload start: storage refused (${label(err)})`);
    return { ok: false, error: STORAGE_FAILED };
  }
  try {
    await db.query(
      `insert into uploads (id, original_name, size_bytes, content_type, folder, r2_key, s3_upload_id) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, check.name, f.size, check.contentType, folder, key, s3UploadId],
    );
  } catch (err) {
    await storage.abortMultipart(key, s3UploadId).catch(() => {});
    throw err;
  }
  return { ok: true, uploadId: id, partSize: PART_SIZE };
}

interface Row {
  id: string;
  status: UploadStatus;
  size_bytes: string | number;
  r2_key: string;
  s3_upload_id: string | null;
  parts: StoredPart[];
}

const load = async (db: Queryable, id: string): Promise<Row | null> =>
  ((await db.query("select id, status, size_bytes, r2_key, s3_upload_id, parts from uploads where id = $1", [id])).rows[0] as Row | undefined) ?? null;

/** One part: the row must be 'uploading'; the size must fit the file (validate.ts); a re-sent part replaces the old one. */
export async function putPart(db: Queryable, storage: MultipartStorage | null, id: string, n: number, body: Uint8Array, log: (l: string) => void = console.error): Promise<{ ok: true; etag: string } | Refusal> {
  if (!isUuid(id)) return refuse(400, "Bad upload id.");
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return refuse(400, "Bad part number.");
  if (body.byteLength > PART_SIZE) return refuse(413, "The part is bigger than the part size.");
  if (!storage) return refuse(503, STORAGE_OFF);
  const row = await load(db, id);
  if (!row) return NOT_FOUND;
  if (row.status !== "uploading" || !row.s3_upload_id) return refuse(409, `This upload is ${row.status}, so it takes no more parts.`);
  const size = check(checkPartSize(n, body.byteLength, Number(row.size_bytes)));
  if (size) return size;
  let etag: string;
  try {
    etag = await storage.uploadPart(row.r2_key, row.s3_upload_id, n, body);
  } catch (err) {
    log(`upload part: storage refused (${label(err)})`);
    return refuse(502, STORAGE_FAILED);
  }
  const part: StoredPart = { n, etag, size: body.byteLength };
  const upd = await db.query(
    `update uploads
        set parts = coalesce((select jsonb_agg(e) from jsonb_array_elements(parts) e where (e->>'n')::int <> $2), '[]'::jsonb) || jsonb_build_array($3::jsonb),
            updated_at = now()
      where id = $1 and status = 'uploading'
      returning id`,
    [id, n, JSON.stringify(part)],
  );
  if (!upd.rows[0]) return refuse(409, "This upload was closed while the part was sent.");
  return { ok: true, etag };
}

function check(c: ReturnType<typeof checkPartSize>): Refusal | null {
  return c.ok ? null : refuse(c.status, c.error);
}

/** Parts 1..count all present, sizes adding up to the file: the list to complete with, else what's missing. */
export function completeParts(parts: StoredPart[], fileSize: number): { ok: true; parts: Array<{ partNumber: number; etag: string }> } | { ok: false; error: string } {
  const count = partCount(fileSize);
  const byN = new Map(parts.map((p) => [p.n, p]));
  const missing: number[] = [];
  for (let n = 1; n <= count; n++) if (!byN.has(n)) missing.push(n);
  if (missing.length) return { ok: false, error: `Parts missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}.` };
  if ([...byN.keys()].some((n) => n > count)) return { ok: false, error: "There are parts past the end of the file." };
  const total = [...byN.values()].reduce((s, p) => s + p.size, 0);
  if (total !== fileSize) return { ok: false, error: "The parts don't add up to the file size." };
  return { ok: true, parts: [...byN.values()].sort((a, b) => a.n - b.n).map((p) => ({ partNumber: p.n, etag: p.etag })) };
}

const LATER: UploadStatus[] = ["uploaded", "processing", "done", "duplicate"];

/** All parts in → R2 completes the object → 'uploaded'. Idempotent: an already-completed upload returns its status. */
export async function completeUpload(db: Queryable, storage: MultipartStorage | null, id: string, log: (l: string) => void = console.error): Promise<{ ok: true; status: UploadStatus } | Refusal> {
  if (!isUuid(id)) return refuse(400, "Bad upload id.");
  const row = await load(db, id);
  if (!row) return NOT_FOUND;
  if (LATER.includes(row.status)) return { ok: true, status: row.status };
  if (row.status !== "uploading" || !row.s3_upload_id) return refuse(409, `This upload is ${row.status}.`);
  if (!storage) return refuse(503, STORAGE_OFF);
  const parts = completeParts(row.parts ?? [], Number(row.size_bytes));
  if (!parts.ok) return refuse(400, parts.error);
  try {
    await storage.completeMultipart(row.r2_key, row.s3_upload_id, parts.parts);
  } catch (err) {
    const now = await load(db, id);
    if (now && LATER.includes(now.status)) return { ok: true, status: now.status }; // a concurrent complete won
    log(`upload complete: storage refused (${label(err)})`);
    return refuse(502, STORAGE_FAILED);
  }
  const upd = await db.query(`update uploads set status = 'uploaded', updated_at = now() where id = $1 and status = 'uploading' returning status`, [id]);
  if (upd.rows[0]) return { ok: true, status: "uploaded" };
  const now = await load(db, id);
  return now && LATER.includes(now.status) ? { ok: true, status: now.status } : refuse(409, `This upload is ${now?.status ?? "gone"}.`);
}

/**
 * Cancel before processing ('uploading' or 'uploaded') → 'aborted'; the parts / raw object are dropped now when
 * storage allows (s3_upload_id cleared), else by the worker's cleanup. Idempotent on an aborted row.
 */
export async function abortUpload(db: Queryable, storage: MultipartStorage | null, id: string, log: (l: string) => void = console.error): Promise<{ ok: true; status: "aborted" } | Refusal> {
  if (!isUuid(id)) return refuse(400, "Bad upload id.");
  const upd = await db.query(
    `update uploads u set status = 'aborted', updated_at = now(), finished_at = now()
       from (select id, status as was from uploads where id = $1 for update) o
      where u.id = o.id and u.status in ('uploading','uploaded')
      returning o.was, u.r2_key, u.s3_upload_id`,
    [id],
  );
  const hit = upd.rows[0] as { was: UploadStatus; r2_key: string; s3_upload_id: string | null } | undefined;
  if (!hit) {
    const row = await load(db, id);
    if (!row) return NOT_FOUND;
    if (row.status === "aborted") return { ok: true, status: "aborted" };
    return refuse(409, `This upload is ${row.status}, so it can't be cancelled.`);
  }
  if (storage && hit.s3_upload_id) {
    try {
      if (hit.was === "uploading") await storage.abortMultipart(hit.r2_key, hit.s3_upload_id);
      else await storage.deleteObject(hit.r2_key);
      await db.query("update uploads set s3_upload_id = null where id = $1 and status = 'aborted'", [id]);
    } catch (err) {
      log(`upload abort: storage cleanup deferred to the worker (${label(err)})`); // the row stays aborted either way
    }
  }
  return { ok: true, status: "aborted" };
}

export interface UploadStatusView {
  id: string;
  status: UploadStatus;
  mediaId?: string;
  posterUrl?: string;
  error?: string;
}

/** Status of exactly the rows these ids name (never anything else), in the order asked. */
export async function uploadStatuses(db: Queryable, ids: string[]): Promise<UploadStatusView[]> {
  const want = [...new Set(ids)].filter(isUuid);
  if (!want.length) return [];
  const { rows } = await db.query(
    `select u.id, u.status, u.media_id, u.error, m.poster_key
       from uploads u left join media m on m.id = u.media_id
      where u.id = any($1::uuid[])`,
    [want],
  );
  const byId = new Map((rows as Array<{ id: string; status: UploadStatus; media_id: string | null; error: string | null; poster_key: string | null }>).map((r) => [r.id, r]));
  return want.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const v: UploadStatusView = { id: r.id, status: r.status };
    if (r.media_id) v.mediaId = r.media_id;
    if (r.media_id && r.poster_key) v.posterUrl = `/app/media/poster/${encodeURIComponent(r.media_id)}`;
    if (r.error) v.error = r.error;
    return [v];
  });
}
