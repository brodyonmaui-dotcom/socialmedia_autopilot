import type { Platform } from "@autopilot/core";
import { Chip, DataList, DataRow, PlatformLogo, Thumb } from "../ui/index.js";
import { PLATFORM_LABEL, fmtInt, postMeta } from "../../lib/analytics/present.js";

export interface PostRowItem {
  id: string;
  platform: Platform;
  title: string;
  permalink: string;
  mediaId: string | null;
  /** Creator-local publish day (YYYY-MM-DD). */
  day: string;
  views: number | null;
  engagementRate: number | null;
  byHand: boolean;
}

/** The post's poster when it's one of the app's clips, else a same-size tile with the platform glyph. */
export function PostLead({ platform, mediaId, title }: { platform: Platform; mediaId: string | null; title: string }) {
  if (mediaId) return <Thumb mediaId={mediaId} alt={`Poster: ${title}`} className="w-9" />;
  return (
    <span aria-hidden="true" className="inline-flex aspect-[9/16] w-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
      <PlatformLogo platform={platform} size={18} />
    </span>
  );
}

/** Top posts as DataRows: poster, title, day + engagement, views on the right; each row opens the post on its platform. */
export function PostRows({ posts, label, showPlatform = true }: { posts: PostRowItem[]; label: string; showPlatform?: boolean }) {
  return (
    <DataList label={label}>
      {posts.map((p) => (
        <DataRow
          key={p.id}
          href={p.permalink}
          external
          leading={<PostLead platform={p.platform} mediaId={p.mediaId} title={p.title} />}
          title={p.title}
          meta={
            <span className="inline-flex items-center gap-1.5">
              {showPlatform ? <PlatformLogo platform={p.platform} size={13} title={PLATFORM_LABEL[p.platform]} className="text-ds-text" /> : null}
              {postMeta(p.day, p.engagementRate)}
            </span>
          }
          trailing={
            <span className="flex flex-col items-end">
              <span>{fmtInt(p.views) ?? "–"}</span>
              <span className="text-[12px] font-normal text-ds-muted">views</span>
            </span>
          }
        >
          {p.byHand ? (
            <div className="-mt-1 pl-12">
              <Chip>Posted by hand</Chip>
            </div>
          ) : null}
        </DataRow>
      ))}
    </DataList>
  );
}
