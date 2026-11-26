// Route cores for the browser upload (F23, server only). The route files are thin wrappers (requireSession +
// pool + R2 from env) so these stay testable with a fake storage. JSON in, JSON out, never cached; errors are
// fixed plain words (no keys, upload ids or upstream bodies).
import type { MultipartStorage } from "@autopilot/media/src/storage.js";
import { abortUpload, completeUpload, putPart, uploadStatuses, type Queryable, type Refusal } from "./data.js";
import { isUuid, MAX_BATCH_FILES, PART_SIZE, parsePartNumber } from "./validate.js";

export interface UploadDeps {
  db: Queryable;
  storage: MultipartStorage | null;
  log?: (line: string) => void;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });

const refused = (r: Refusal) => json(r.status, { error: r.error });

/** PUT body = raw bytes of part n → 200 { etag }. Oversized bodies are refused before (by Content-Length) or right after reading. */
export async function handlePart(d: UploadDeps, id: string, nRaw: string, req: Request): Promise<Response> {
  if (!isUuid(id)) return json(400, { error: "Bad upload id." });
  const n = parsePartNumber(nRaw);
  if (n === null) return json(400, { error: "Bad part number." });
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > PART_SIZE) return json(413, { error: "The part is bigger than the part size." });
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > PART_SIZE) return json(413, { error: "The part is bigger than the part size." });
  const r = await putPart(d.db, d.storage, id, n, body, d.log);
  return r.ok ? json(200, { etag: r.etag }) : refused(r);
}

/** POST → 200 { status } ("uploaded", or the later status when already completed). */
export async function handleComplete(d: UploadDeps, id: string): Promise<Response> {
  const r = await completeUpload(d.db, d.storage, id, d.log);
  return r.ok ? json(200, { status: r.status }) : refused(r);
}

/** POST → 200 { status: "aborted" }. */
export async function handleAbort(d: UploadDeps, id: string): Promise<Response> {
  const r = await abortUpload(d.db, d.storage, id, d.log);
  return r.ok ? json(200, { status: r.status }) : refused(r);
}

/** GET ?ids=a,b → 200 [{ id, status, mediaId?, posterUrl?, error? }] for exactly those ids. */
export async function handleStatus(d: Pick<UploadDeps, "db">, url: string): Promise<Response> {
  const raw = new URL(url, "http://local").searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > MAX_BATCH_FILES || ids.some((id) => !isUuid(id))) return json(400, { error: "Bad upload ids." });
  return json(200, await uploadStatuses(d.db, ids));
}
