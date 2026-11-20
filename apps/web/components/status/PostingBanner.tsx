import type { PostingBannerView } from "../../lib/status/posting.js";
import { cx, InlineNotice } from "../ui/index.js";

/**
 * F18 posting status: one InlineNotice per problem (dry run / worker silent, then missed posts), or on the
 * Calendar a quiet "Posting is on" line with a blue live dot. Renders nothing when there is nothing to say.
 * The view (copy, tones, links) comes from postingBanner() in lib/status/posting.ts.
 */
export function PostingBanner({ view, className }: { view: PostingBannerView; className?: string }) {
  if (view.notices.length === 0 && !view.quiet) return null;
  if (view.notices.length === 0) {
    return (
      <p className={cx("flex items-center gap-2 text-[13px] text-ds-muted", className)}>
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ds-accent" />
        {view.quiet}
      </p>
    );
  }
  return (
    <div className={cx("flex flex-col gap-3 lg:gap-4", className)}>
      {view.notices.map((n) => (
        <InlineNotice key={n.text} tone={n.tone} href={n.href} linkLabel={n.linkLabel} action={n.action}>
          {n.text}
          {n.detail ? <span className="mt-0.5 block text-[14px] leading-snug text-ds-muted">{n.detail}</span> : null}
        </InlineNotice>
      ))}
    </div>
  );
}
