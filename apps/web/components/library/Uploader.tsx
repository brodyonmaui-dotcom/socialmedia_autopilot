"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { checkUploadsAction, startUploadAction } from "../../app/library/upload-actions.js";
import {
  classifyFiles,
  folderLabel,
  formatBytes,
  FILE_CONCURRENCY,
  MAX_FILES,
  needsPolling,
  progressOf,
  rowStatusFromServer,
  runPool,
  sameFile,
  splitParts,
  statusLabel,
  withRetry,
  type PickedFile,
  type RowStatus,
} from "../../lib/library/upload-queue.js";
import { Button, Checkbox, Chip, cx, Icon, InlineNotice, Thumb } from "../ui/index.js";

interface Row {
  key: string;
  file: File;
  name: string;
  size: number;
  relPath: string;
  folder: string | null;
  status: RowStatus;
  /** 0..1 */
  progress: number;
  /** Ticked = will upload when you press Upload. */
  selected: boolean;
  uploadId?: string;
  mediaId?: string;
  error?: string;
}

const POLL_MS = 5000;
let seq = 0;

/** Files from a drop, folders walked (webkitGetAsEntry), each with its path under the dropped folder. */
async function filesFromDrop(e: DragEvent): Promise<Array<{ file: File; relPath: string }>> {
  const out: Array<{ file: File; relPath: string }> = [];
  const items = Array.from(e.dataTransfer.items ?? []);
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  if (entries.some((x) => x)) {
    const walk = async (entry: FileSystemEntry, base: string): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        out.push({ file, relPath: base ? `${base}/${entry.name}` : "" });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const here = base ? `${base}/${entry.name}` : entry.name;
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          if (batch.length === 0) break;
          for (const child of batch) await walk(child, here);
        }
      }
    };
    for (const en of entries) if (en) await walk(en, "");
    return out;
  }
  return Array.from(e.dataTransfer.files).map((file) => ({ file, relPath: "" }));
}

export function Uploader() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [overLimit, setOverLimit] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  const pausedRef = useRef(false);
  const stoppedRef = useRef(false);
  const xhrs = useRef(new Set<XMLHttpRequest>());
  const lastDone = useRef(0);

  const patch = useCallback((key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))), []);

  // ---- adding files -------------------------------------------------------------------------------------------
  const add = useCallback(async (picked: Array<{ file: File; relPath: string }>) => {
    setMessage(null);
    const room = MAX_FILES - rowsRef.current.length;
    const meta: PickedFile[] = picked.map((p) => ({ name: p.file.name, size: p.file.size, type: p.file.type, relPath: p.relPath }));
    const keep = classifyFiles(meta, room);
    const accepted = new Set(keep.accepted);
    setIgnored((n) => n + keep.ignored);
    setOverLimit((n) => n + keep.overLimit);
    const fresh: Row[] = [];
    picked.forEach((p, i) => {
      const m = meta[i]!;
      if (!accepted.has(m)) return;
      if (rowsRef.current.concat(fresh).some((r) => r.relPath === p.relPath && sameFile(r, m))) return;
      fresh.push({ key: `f${++seq}`, file: p.file, name: m.name, size: m.size, relPath: p.relPath, folder: folderLabel(p.relPath), status: "checking", progress: 0, selected: true });
    });
    if (fresh.length === 0) return;
    setRows((rs) => [...rs, ...fresh]);
    try {
      const res = await checkUploadsAction(fresh.map((r) => ({ name: r.name, size: r.size })));
      setRows((rs) =>
        rs.map((r) => {
          if (!fresh.some((f) => f.key === r.key)) return r;
          const found = res.find((x) => x.already && sameFile(x, r));
          return found ? { ...r, status: "already", selected: false, mediaId: found.mediaId } : { ...r, status: "waiting" };
        }),
      );
    } catch {
      setRows((rs) => rs.map((r) => (fresh.some((f) => f.key === r.key) ? { ...r, status: "waiting" } : r)));
      setMessage("Couldn't check for repeats. You can still upload; repeats are caught after processing.");
    }
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    void add(list.map((file) => ({ file, relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "" })));
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void add(await filesFromDrop(e));
  };

  // ---- uploading ----------------------------------------------------------------------------------------------
  const waitIfPaused = async () => {
    while (pausedRef.current && !stoppedRef.current) await new Promise((r) => setTimeout(r, 250));
  };

  const putPart = (url: string, body: Blob, onProgress: (loaded: number) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      xhrs.current.add(x);
      x.open("PUT", url);
      x.upload.onprogress = (ev) => onProgress(ev.loaded);
      x.onload = () => {
        xhrs.current.delete(x);
        if (x.status >= 200 && x.status < 300) resolve();
        else reject(new Error(`part ${x.status}`));
      };
      x.onerror = () => {
        xhrs.current.delete(x);
        reject(new Error("network"));
      };
      x.onabort = () => {
        xhrs.current.delete(x);
        reject(new Error("stopped"));
      };
      x.send(body);
    });

  const uploadOne = async (row: Row) => {
    await waitIfPaused();
    if (stoppedRef.current) return;
    patch(row.key, { status: "uploading", progress: 0, error: undefined });
    let uploadId: string | undefined;
    try {
      const start = await startUploadAction({ name: row.name, size: row.size, type: row.file.type || "video/mp4", ...(row.relPath ? { relPath: row.relPath } : {}) });
      if (!start.ok) throw new Error(start.error);
      uploadId = start.uploadId;
      patch(row.key, { uploadId });
      let sent = 0;
      for (const part of splitParts(row.size, start.partSize)) {
        await waitIfPaused();
        if (stoppedRef.current) throw new Error("stopped");
        const blob = row.file.slice(part.start, part.end);
        await withRetry(() => putPart(`/app/media/upload/${uploadId}/part/${part.n}`, blob, (loaded) => patch(row.key, { progress: progressOf(row.size, sent, loaded) })), {
          shouldStop: () => stoppedRef.current,
        });
        sent += part.end - part.start;
        patch(row.key, { progress: progressOf(row.size, sent) });
      }
      const res = await fetch(`/app/media/upload/${uploadId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete ${res.status}`);
      patch(row.key, { status: "processing", progress: 1 });
    } catch (err) {
      if (uploadId) void fetch(`/app/media/upload/${uploadId}/abort`, { method: "POST" }).catch(() => {});
      if (stoppedRef.current) patch(row.key, { status: "cancelled" });
      else patch(row.key, { status: "failed", error: (err as Error).message === "network" ? "Connection lost" : "Upload failed" });
    }
  };

  const run = async (queue: Row[]) => {
    stoppedRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setRunning(true);
    setRows((rs) => rs.map((r) => (queue.some((q) => q.key === r.key) ? { ...r, status: "waiting", progress: 0, error: undefined } : r)));
    await runPool(queue, FILE_CONCURRENCY, uploadOne, () => stoppedRef.current);
    setRunning(false);
  };

  const startAll = () => void run(rowsRef.current.filter((r) => r.selected && (r.status === "waiting" || r.status === "failed" || r.status === "cancelled")));

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const stopAll = () => {
    stoppedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    xhrs.current.forEach((x) => x.abort());
    setRows((rs) => rs.map((r) => (r.status === "uploading" || r.status === "waiting" ? { ...r, status: "cancelled" } : r)));
  };

  // ---- processing poll ----------------------------------------------------------------------------------------
  const pollIds = needsPolling(rows).join(",");
  useEffect(() => {
    if (!pollIds) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/app/media/upload/status?ids=${pollIds}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const list = (await res.json()) as Array<{ id: string; status: string; mediaId?: string; error?: string }>;
        setRows((rs) =>
          rs.map((r) => {
            const s = list.find((x) => x.id === r.uploadId);
            if (!s || r.status !== "processing") return r;
            const status = rowStatusFromServer(s.status);
            return status === "processing" ? r : { ...r, status, mediaId: s.mediaId ?? r.mediaId, error: s.error ? "Processing failed" : r.error };
          }),
        );
      } catch {
        /* next tick */
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pollIds]);

  // New "Done" rows: refresh the Ready to post list below.
  const doneCount = rows.filter((r) => r.status === "done").length;
  useEffect(() => {
    if (doneCount > lastDone.current) router.refresh();
    lastDone.current = doneCount;
  }, [doneCount, router]);

  // ---- leave warning ------------------------------------------------------------------------------------------
  const busy = running || rows.some((r) => r.status === "uploading");
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  const folderProps = { webkitdirectory: "", directory: "" } as Record<string, string>;
  const selected = rows.filter((r) => r.selected && (r.status === "waiting" || r.status === "failed" || r.status === "cancelled"));
  const selectedBytes = useMemo(() => selected.reduce((n, r) => n + r.size, 0), [selected]);
  const checking = rows.some((r) => r.status === "checking");

  return (
    <section aria-labelledby="uploader-title" className="flex flex-col gap-3 lg:gap-4">
      <h2 id="uploader-title" className="sr-only">
        Upload videos
      </h2>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "flex flex-col items-center gap-4 rounded-ds-lg border border-dashed px-4 py-10 text-center transition-colors duration-[var(--ds-dur)] ease-ds lg:py-14",
          dragging ? "border-ds-accent bg-ds-raised" : "border-ds-line-strong bg-ds-card",
        )}
      >
        <span className="grid size-12 place-items-center rounded-ds-lg border border-ds-line bg-ds-raised text-ds-text">
          <Icon name="film" size={22} />
        </span>
        <div>
          <p className="ds-heading text-ds-text">Drop videos or a whole folder here</p>
          <p className="mt-1 text-[14px] text-ds-muted">MP4, MOV or M4V, up to 2 GB each and 200 files at a time. The folder name becomes the clip&rsquo;s folder.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="solid" onClick={() => fileInput.current?.click()}>
            Choose files
          </Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()}>
            Choose folder
          </Button>
        </div>
        <input ref={fileInput} type="file" multiple accept="video/*" className="sr-only" tabIndex={-1} aria-label="Choose video files" onChange={onPick} />
        <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose a folder of videos" onChange={onPick} {...folderProps} />
        <p className="flex items-center gap-1.5 text-[13px] text-ds-muted">
          <Icon name="lock" size={14} className="shrink-0" />
          Location data is removed from every video before it&rsquo;s stored.
        </p>
      </div>

      {message ? <InlineNotice tone="warn">{message}</InlineNotice> : null}
      {ignored > 0 || overLimit > 0 ? (
        <p className="text-[13px] text-ds-muted" role="status">
          {[ignored > 0 ? `${ignored} other ${ignored === 1 ? "file" : "files"} ignored` : "", overLimit > 0 ? `${overLimit} left out (200 files at a time)` : ""].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-ds-line px-4 py-3 lg:px-5">
            <h3 className="ds-heading mr-auto text-ds-text">
              Queue <span className="ds-num font-normal text-ds-muted">{rows.length}</span>
            </h3>
            {running ? (
              <>
                <Button size="sm" variant="outline" onClick={togglePause}>
                  {paused ? "Resume" : "Pause all"}
                </Button>
                <Button size="sm" variant="outline" tone="danger" onClick={stopAll}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="solid" disabled={selected.length === 0 || checking} onClick={startAll}>
                {selected.length === 0 ? "Upload" : `Upload ${selected.length} ${selected.length === 1 ? "file" : "files"} · ${formatBytes(selectedBytes)}`}
              </Button>
            )}
          </div>
          <ul aria-label="Upload queue" className="divide-y divide-ds-line">
            {rows.map((r) => (
              <QueueRow key={r.key} row={r} locked={running && (r.status === "uploading" || r.status === "waiting")} onToggle={(v) => patch(r.key, { selected: v })} onRetry={() => void run([r])} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function QueueRow({ row: r, locked, onToggle, onRetry }: { row: Row; locked: boolean; onToggle: (v: boolean) => void; onRetry: () => void }) {
  const canTick = r.status === "waiting" || r.status === "already" || r.status === "failed" || r.status === "cancelled";
  const tone = r.status === "failed" ? "danger" : r.status === "duplicate" || r.status === "already" ? "warn" : r.status === "done" ? "accent" : "neutral";
  const showBar = r.status === "uploading" || r.status === "paused";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:flex-nowrap lg:gap-x-4 lg:px-5">
      <div className="flex w-full min-w-0 items-center gap-3 lg:w-auto lg:flex-1">
        {canTick ? <Checkbox label={<span className="sr-only">Upload {r.name}</span>} checked={r.selected} disabled={locked} onChange={(e) => onToggle(e.target.checked)} className="shrink-0" /> : null}
        {r.status === "done" && r.mediaId ? <Thumb mediaId={r.mediaId} alt={`${r.name} poster`} className="w-[36px] shrink-0" /> : null}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ds-text">{r.name}</p>
          <p className="truncate text-[13px] text-ds-muted">
            <span className="ds-num">{formatBytes(r.size)}</span>
            {r.folder ? <span> · Folder {r.folder}</span> : null}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:w-[360px] lg:flex-none lg:justify-end">
        {showBar ? (
          <div
            role="progressbar"
            aria-label={`${r.name} upload`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(r.progress * 100)}
            className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-ds-xs bg-ds-raised"
          >
            <div className="h-full bg-ds-accent transition-[width] duration-[var(--ds-dur)] ease-ds" style={{ width: `${Math.round(r.progress * 100)}%` }} />
          </div>
        ) : null}
        <Chip tone={tone} size="sm">
          {statusLabel(r)}
          {r.status === "failed" && r.error ? ` · ${r.error}` : ""}
        </Chip>
        {r.status === "failed" || r.status === "cancelled" ? (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={locked} aria-label={`Retry ${r.name}`}>
            Retry
          </Button>
        ) : null}
      </div>
    </li>
  );
}
