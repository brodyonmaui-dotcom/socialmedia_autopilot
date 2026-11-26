/** Pure helpers for the export status chip (the poll itself lives in the editor). */
export type RenderStatus = "queued" | "running" | "done" | "failed";
export interface StatusRow { id: string; status: RenderStatus; resultMediaId?: string; posterUrl?: string; error?: string }
export const POLL_MS = 5000;

export function parseStatus(raw: unknown, id: string): StatusRow | null {
  if (!Array.isArray(raw)) return null;
  const r = raw.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === id) as StatusRow | undefined;
  return r && ["queued", "running", "done", "failed"].includes(r.status) ? r : null;
}
export const isFinished = (s: RenderStatus | null) => s === "done" || s === "failed";
export function statusLabel(s: RenderStatus): string {
  return s === "queued" ? "Queued" : s === "running" ? "Rendering" : s === "done" ? "Done" : "Failed";
}
