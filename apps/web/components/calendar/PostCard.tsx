import type { Platform } from "@autopilot/core";
import { approveItemsAction } from "../../app/calendar/actions.js";
import { formatDuration } from "../../lib/batches/view-model.js";
import type { Entry, PlatformEntry, Tone } from "../../lib/calendar/model.js";
import { Badge, Button, ButtonLink, cx, Menu, PLATFORM_NAME, PlatformLogo, type MenuItem } from "../ui/index.js";
import { PostHoverPreview, type PreviewData } from "./PostHoverPreview.js";

/** Status dot colour per platform item (a word always sits next to it in the accessible name). */
const DOT: Record<Tone | "scheduled" | "posted", string> = {
  accent: "bg-ds-accent",
  danger: "bg-ds-danger",
  warn: "bg-ds-warn",
  neutral: "bg-ds-text",
  scheduled: "bg-ds-text",
  posted: "bg-ds-line-strong",
};
const dotOf = (p: PlatformEntry) => (p.status === "published" ? DOT.posted : DOT[p.tone]);
const BADGE: Record<Tone, "neutral" | "accent" | "warn" | "danger"> = { neutral: "neutral", accent: "accent", warn: "warn", danger: "danger" };

/** Hrefs a card needs; the page builds them from its URL state. */
export interface PostCardLinks {
  edit: (key: string) => string;
  move: (key: string) => string;
  reject: (key: string) => string;
  reset: (itemId: string) => string;
  handoff: string;
}

export const itemField = (p: Pick<PlatformEntry, "batchId" | "itemId">) => `${p.batchId}:${p.itemId}`;

export function previewOf(e: Entry): PreviewData {
  return {
    mediaId: e.mediaId,
    title: e.title,
    caption: e.caption,
    duration: formatDuration(e.durationS) || null,
    platforms: e.platforms.map((p) => ({ platform: p.platform, time: p.time, caption: p.text.caption, title: p.text.title })),
  };
}

/** The ⋯ menu: Approve, Edit text, Move…, Reject, then Retry / Record per failed or unknown post, Open handoff. */
export function menuItems(e: Entry, back: string, links: PostCardLinks): MenuItem[] {
  const approvable = e.platforms.filter((p) => p.canApprove);
  const editable = e.platforms.filter((p) => p.canEdit);
  const items: MenuItem[] = [];
  if (approvable.length) items.push({ label: approvable.length === e.platforms.length ? "Approve" : `Approve ${approvable.length} of ${e.platforms.length}`, icon: "check", action: approveItemsAction, fields: { back, item: approvable.map(itemField) } });
  if (editable.length) {
    items.push({ label: "Edit text", icon: "message", href: links.edit(e.key) });
    items.push({ label: "Move…", icon: "calendar", href: links.move(e.key) });
    items.push({ label: "Reject", icon: "x", href: links.reject(e.key), tone: "danger" });
  }
  for (const p of e.platforms) if (p.canReset || p.canRecord) items.push({ label: `Retry or record: ${PLATFORM_NAME[p.platform]}`, icon: "alert", href: links.reset(p.itemId) });
  if (e.platforms.some((p) => p.platform === "snapchat")) items.push({ label: "Open handoff", icon: "share", href: links.handoff });
  return items;
}

/**
 * Compact, horizontal post card (~112 px): the 9:16 thumb (hover / tap → preview), the title in the display
 * face, a two-line caption, then the platforms (glyph, time, status dot), the niche tag and the status
 * Badge. `actions="menu"`: the ⋯ menu top-right (calendar). `actions="approve"`: just an Approve button
 * (Home). Every action is a server action through planTransition.
 */
export function PostCard({
  entry: e,
  back,
  links,
  actions = "menu",
  emphasise = false,
  className,
}: {
  entry: Entry;
  back: string;
  links?: PostCardLinks;
  actions?: "menu" | "approve";
  /** `?status=draft`: entries needing approval get an accent ring, others are muted. */
  emphasise?: boolean;
  className?: string;
}) {
  const menu = actions === "menu" && links ? menuItems(e, back, links) : [];
  const approvable = e.platforms.filter((p) => p.canApprove);
  const dim = emphasise && e.status !== "needs-you";
  return (
    <article
      aria-label={`${e.title}, ${e.statusLabel}`}
      className={cx(
        "flex min-h-[136px] gap-3 rounded-ds-lg border bg-ds-card p-3",
        emphasise && e.status === "needs-you" ? "border-ds-accent" : "border-ds-line",
        dim && "opacity-60",
        className,
      )}
    >
      <PostHoverPreview data={previewOf(e)} thumbClassName="w-[63px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <h3 className="ds-font-display min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap pt-0.5 text-[20px] leading-tight text-ds-text lg:text-[22px]">{e.title}</h3>
          {menu.length ? <div className="-mr-1.5 -mt-1.5 shrink-0"><Menu label={`Actions for ${e.title}`} items={menu} /></div> : null}
        </div>
        {e.caption ? (
          <p className="line-clamp-2 text-[14px] leading-snug text-ds-muted">{e.caption}</p>
        ) : (
          <p className="text-[14px] text-ds-muted">{e.platforms.every((p) => p.platform === "snapchat") ? "Shared by hand; the text is added in Snapchat." : "No caption yet."}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1.5">
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Platforms">
            {e.platforms.map((p) => (
              <li key={p.itemId} className="flex items-center gap-1.5 text-[13px] text-ds-text">
                <PlatformLogo platform={p.platform as Platform} size={14} />
                <span className="ds-num">{p.time ?? "–"}</span>
                <span aria-hidden="true" className={cx("size-1.5 rounded-full", dotOf(p))} />
                <span className="sr-only">
                  {PLATFORM_NAME[p.platform]}: {p.statusLabel}
                </span>
              </li>
            ))}
          </ul>
          {e.pillar ? <span className="ds-tag text-ds-muted">{e.pillar}</span> : null}
          <Badge tone={BADGE[e.tone]} className="ml-auto">
            {e.statusLabel}
          </Badge>
        </div>
        {actions === "approve" && approvable.length === 0 && e.day ? (
          <div className="pt-2">
            <ButtonLink href={`/calendar?status=draft&day=${e.day}&d=${e.day}`} variant="ghost" size="sm">
              Fix in the calendar
            </ButtonLink>
          </div>
        ) : null}
        {actions === "approve" && approvable.length ? (
          <form action={approveItemsAction} className="pt-2">
            <input type="hidden" name="back" value={back} />
            {approvable.map((p) => (
              <input key={p.itemId} type="hidden" name="item" value={itemField(p)} />
            ))}
            <Button type="submit" variant="outline" size="sm" aria-label={`Approve ${e.title}`}>
              Approve
            </Button>
          </form>
        ) : null}
      </div>
    </article>
  );
}
