import type { Platform } from "@autopilot/core";
import { approveItemsAction } from "../../app/calendar/actions.js";
import { formatDuration } from "../../lib/batches/view-model.js";
import { type CardLinks, type Entry, type PlatformEntry, type Tone } from "../../lib/calendar/model.js";
import { Badge, Chip, cx, Icon, Menu, PLATFORM_NAME, PlatformLogo, type MenuItem } from "../ui/index.js";
import { PostHoverPreview, type PreviewData } from "./PostHoverPreview.js";

const TONE: Record<Tone, "neutral" | "accent" | "warn" | "danger"> = { neutral: "neutral", accent: "accent", warn: "warn", danger: "danger" };

/** Hrefs a card needs; the page builds them from its URL state (Home: `linksFromHome`). */
export type PostCardLinks = CardLinks;

export const itemField = (p: Pick<PlatformEntry, "batchId" | "itemId">) => `${p.batchId}:${p.itemId}`;

export function previewOf(e: Entry): PreviewData {
  return {
    mediaId: e.mediaId,
    title: e.title,
    caption: e.caption,
    duration: formatDuration(e.durationS) || null,
    platforms: e.platforms.map((p) => ({ platform: p.platform, time: p.time12, caption: p.text.caption, title: p.text.title })),
  };
}

/**
 * The ⋯ menu (same on every surface): "Approve <Platform>" per approvable line (+ "Approve all N on this card"),
 * a disabled "Can't approve <Platform>: <reason>" per blocked draft, "Auto-schedule at nearest slot" per missed
 * post, Edit text / Move… / Reject, Retry or record, Open handoff.
 */
export function menuItems(e: Entry, back: string, links: PostCardLinks): MenuItem[] {
  const approvable = e.platforms.filter((p) => p.state === "needs-approval");
  const blocked = e.platforms.filter((p) => p.state === "needs-fix");
  const missed = e.platforms.filter((p) => p.state === "missed");
  const editable = e.platforms.filter((p) => p.canEdit);
  const items: MenuItem[] = [];
  for (const p of approvable) items.push({ label: `Approve ${PLATFORM_NAME[p.platform]}`, icon: "check", action: approveItemsAction, fields: { back, item: [itemField(p)] } });
  if (approvable.length > 1) items.push({ label: `Approve all ${approvable.length} on this card`, icon: "check", action: approveItemsAction, fields: { back, item: approvable.map(itemField) } });
  for (const p of blocked) items.push({ label: `Can't approve ${PLATFORM_NAME[p.platform]}: ${p.fix ?? "needs a fix"}`, icon: "alert", disabled: true });
  for (const p of missed) items.push({ label: missed.length > 1 ? `Auto-schedule ${PLATFORM_NAME[p.platform]} at nearest slot` : "Auto-schedule at nearest slot", icon: "clock", href: links.reschedule(p.itemId, e.day), scroll: false });
  if (editable.length) {
    items.push({ label: "Edit text", icon: "message", href: links.edit(e.key) });
    items.push({ label: "Move…", icon: "calendar", href: links.move(e.key) });
    items.push({ label: "Reject", icon: "x", href: links.reject(e.key), tone: "danger" });
  }
  for (const p of e.platforms) if (p.canReset || p.canRecord) items.push({ label: `Retry or record: ${PLATFORM_NAME[p.platform]}`, icon: "alert", href: links.reset(p.itemId, e.day) });
  if (e.platforms.some((p) => p.platform === "snapchat")) items.push({ label: "Open handoff", icon: "share", href: links.handoff });
  return items;
}

/** "Posted": a quiet check and word, no bubble. */
const PostedMark = ({ className }: { className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 text-[12px] text-ds-muted", className)}>
    <Icon name="check" size={12} aria-hidden="true" />
    Posted
  </span>
);

/** One platform line's own chip (state word; Posted is the quiet mark). */
function LineChip({ p }: { p: PlatformEntry }) {
  if (p.state === "posted") return <PostedMark />;
  return (
    <Chip size="sm" tone={TONE[p.tone]}>
      {p.statusLabel}
    </Chip>
  );
}

/**
 * Compact, horizontal post card: the 9:16 thumb (hover / tap → preview), then the title (display face) with
 * the ⋯ menu top-right, a two-line caption, and one line per platform (logo, 12-hour time, its own chip).
 * With two or more lines a card-level chip sums them up ("1 of 3 needs approval"). Posted cards with nothing
 * to do show a check + "Posted" where the menu would be. Every action is a server action through planTransition.
 */
export function PostCard({
  entry: e,
  back,
  links,
  emphasise = false,
  className,
}: {
  entry: Entry;
  back: string;
  links: PostCardLinks;
  /** `?status=draft`: entries needing approval get an accent ring, others are muted. */
  emphasise?: boolean;
  className?: string;
}) {
  const menu = menuItems(e, back, links);
  const dim = emphasise && e.status !== "needs-you";
  const allPosted = e.platforms.length > 0 && e.platforms.every((p) => p.state === "posted");
  const summary = e.platforms.length > 1 && !allPosted;
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
          {menu.length ? (
            <div className="-mr-1.5 -mt-1.5 shrink-0">
              <Menu label={`Actions for ${e.title}`} items={menu} width={288} />
            </div>
          ) : allPosted ? (
            <PostedMark className="shrink-0 pt-1.5" />
          ) : null}
        </div>
        {e.caption ? (
          <p className="line-clamp-2 text-[14px] leading-snug text-ds-muted">{e.caption}</p>
        ) : (
          <p className="text-[14px] text-ds-muted">{e.platforms.every((p) => p.platform === "snapchat") ? "Shared by hand; the text is added in Snapchat." : "No caption yet."}</p>
        )}
        <ul className="mt-auto flex flex-col gap-1 pt-1.5" aria-label="Platforms">
          {e.platforms.map((p) => (
            <li key={p.itemId} className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-text">
              <PlatformLogo platform={p.platform as Platform} size={14} />
              <span className="sr-only">{PLATFORM_NAME[p.platform]}:</span>
              <span className="ds-num">{p.time12 ?? "–"}</span>
              <LineChip p={p} />
              {p.fix && p.state === "needs-fix" ? <span className="text-[12px] text-ds-muted">{p.fix}</span> : null}
            </li>
          ))}
        </ul>
        {summary || e.pillar ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            {e.pillar ? <span className="ds-tag text-ds-muted">{e.pillar}</span> : null}
            {summary ? (
              <Badge tone={TONE[e.tone]} className="ml-auto">
                {e.statusLabel}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
