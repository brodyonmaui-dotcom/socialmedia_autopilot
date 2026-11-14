"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCard,
  Badge,
  Button,
  CONTAINER,
  ConfirmSheet,
  FramedImage,
  GlassCard,
  Icon,
  Input,
  ListRow,
  ListRows,
  PlatformLogo,
  Readout,
  cx,
} from "../../../components/ui/index.js";
import type { ActionResult, HandoffItem } from "../../../lib/handoff/types.js";
import { durationLabel, orderedChecklist, resultText, shareStep } from "../../../lib/handoff/view.js";
import { dropAction, markPostedAction, skipAction } from "../actions.js";
import { ShareButton } from "./ShareButton.js";
import { initialState, type ShareState } from "./share-machine.js";

/** Copies the trimmed caption (step 2 of the runbook) before the share sheet opens. */
function CopyCaption({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0 px-4"
      aria-label={done ? "Caption copied" : "Copy caption"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Icon name="check" size={16} /> : null}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

/** A blob: URL for the prepared File (preview only); revoked when the file changes or the card unmounts. */
function useObjectUrl(file: File | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/**
 * One due Snapchat item as a bordered grid band: preview (5 cols) | caption, privacy checklist, the two-tap
 * share and the Mark posted / Skip / Drop sheets (7 cols). `missed` swaps the preview for a ListRow cell.
 */
export function HandoffCard({ item, when, missed = false }: { item: HandoffItem; when: string; missed?: boolean }) {
  const router = useRouter();
  const [share, setShare] = useState<ShareState>(() => initialState(item.blocks));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const clip = useObjectUrl("file" in share ? share.file : undefined);
  const length = durationLabel(item.durationS);
  const checklist = orderedChecklist(item.checklist);
  const headingId = `snap-${item.id}`;

  async function run(verb: string, fn: () => Promise<ActionResult>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: resultText(r, verb) });
      if (r.ok) {
        setUrl("");
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby={headingId} className="border-b border-ds-line">
      <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
        {/* Preview / identity */}
        <div className="col-span-4 min-w-0 pt-6 lg:col-span-5 lg:py-10 lg:pr-10">
          {missed ? (
            <ListRows label="Missed item" className="border-y border-ds-line">
              <ListRow
                avatar={{ platform: "snapchat" }}
                title={item.label}
                subtitle={when}
                trailing={<Badge tone="warn">Missed</Badge>}
              />
            </ListRows>
          ) : (
            <FramedImage
              alt={clip ? `${item.label}: prepared clip` : `${item.label} preview (placeholder)`}
              video={clip}
              ratio="3/2"
              className="lg:aspect-[4/5]"
            >
              {!clip && (
                <div className="absolute inset-x-5 bottom-5">
                  <GlassCard title="Preview" code={length ?? undefined}>
                    <p className="ds-mono text-ds-muted">Prepare the clip to preview it here.</p>
                  </GlassCard>
                </div>
              )}
            </FramedImage>
          )}
        </div>

        {/* Details + actions */}
        <div className="col-span-4 flex min-w-0 flex-col gap-6 py-6 lg:col-span-7 lg:border-l lg:border-ds-line lg:py-10 lg:pl-10">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="ds-caps inline-flex items-center gap-2 text-ds-text">
                <PlatformLogo platform="snapchat" size={18} />
                Spotlight
              </span>
              <span className="ds-mono text-ds-muted">{when}</span>
            </div>
            <h3 id={headingId} className="text-[28px] font-black leading-[1.05] tracking-[-0.03em] lg:text-[40px]">
              {item.label}
            </h3>
            <Readout
              items={[
                { k: "Length", v: length ?? "—" },
                { k: "Clean file", v: item.hasCleanFile ? "Ready" : "Missing" },
                { k: "Step", v: `${shareStep(share)} · ${share.kind === "shared" ? "shared" : "prepare → share"}` },
                { k: "Limit", v: "1 per day" },
              ]}
            />
          </div>

          {/* Caption (copy before sharing) */}
          <div className="flex flex-col gap-2">
            <p className="ds-caps text-ds-muted">Caption</p>
            <div className="flex items-stretch border border-ds-line bg-ds-card">
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words p-4 text-[16px] leading-snug text-ds-text">
                {item.caption || <span className="text-ds-muted">(no caption)</span>}
              </p>
              {item.caption ? (
                <div className="flex items-start border-l border-ds-line p-2">
                  <CopyCaption text={item.caption} />
                </div>
              ) : null}
            </div>
          </div>

          {/* Privacy checklist: location / Snap Map first, every time */}
          <div className="flex flex-col gap-2">
            <p className="ds-caps text-ds-muted">Before you post</p>
            <ol className="divide-y divide-ds-line border border-ds-line">
              {checklist.map((line, i) =>
                line.privacy ? (
                  <li key={i} className="flex min-h-11 items-start gap-3 bg-ds-card px-4 py-3">
                    <Icon name="alert" size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-ds-warn" />
                    <span className="min-w-0 flex-1 text-[16px] font-bold leading-snug text-ds-text">{line.text}</span>
                    <Badge tone="warn">
                      Every time
                    </Badge>
                  </li>
                ) : (
                  <li key={i} className="flex min-h-11 items-start gap-3 px-4 py-3">
                    <span aria-hidden="true" className="ds-mono mt-0.5 w-[18px] shrink-0 text-ds-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] leading-snug text-ds-muted">{line.text}</span>
                  </li>
                ),
              )}
            </ol>
          </div>

          {item.blocks.length > 0 ? (
            <AlertCard tone="light" title="Share blocked">
              <ul className="flex flex-col gap-1">
                {item.blocks.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </AlertCard>
          ) : null}

          <div className="flex flex-col gap-2">
          <ShareButton itemId={item.id} caption={item.caption} blocks={item.blocks} state={share} setState={setShare} />

          <div className="grid grid-cols-2 gap-2">
            <ConfirmSheet
              triggerLabel="Mark posted"
              triggerVariant="outline"
              triggerClassName="col-span-2 w-full"
              disabled={busy}
              title="Mark as posted on Spotlight?"
              confirmLabel="Confirm: posted"
              onConfirm={() => run("Marked posted", () => markPostedAction(item.id, url.trim() || null))}
              body={
                <div className="flex flex-col gap-5">
                  <p>Only once it&apos;s live on Spotlight. This can&apos;t be undone here.</p>
                  <Input
                    label="Spotlight link (optional)"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://…snapchat.com/…"
                    helper="Only snapchat.com links are kept."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              }
            />
            <ConfirmSheet
              triggerLabel="Skip today"
              triggerVariant="outline"
              triggerClassName="w-full px-3"
              disabled={busy}
              title="Skip to the next free day?"
              confirmLabel="Confirm: skip"
              onConfirm={() => run("Skipped", () => skipAction(item.id))}
              body={<p>It moves to the next day with no other Snapchat post, same time. It stays approved.</p>}
            />
            <ConfirmSheet
              triggerLabel="Drop"
              triggerVariant="outline"
              triggerTone="danger"
              triggerClassName="w-full px-3"
              disabled={busy}
              title="Drop this Snapchat post?"
              confirmLabel="Confirm: drop"
              onConfirm={() => run("Dropped", () => dropAction(item.id))}
              body={<p>It&apos;s rejected and won&apos;t come back. Skip today moves it to the next free day instead.</p>}
            />
          </div>
          </div>

          {msg ? (
            <p
              role={msg.ok ? "status" : "alert"}
              className={cx("flex items-start gap-2 text-[15px] leading-snug", msg.ok ? "text-ds-accent-fg" : "text-ds-danger")}
            >
              <Icon name={msg.ok ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
              {msg.text}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
