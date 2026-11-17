import type { Platform } from "@autopilot/core";
import Link from "next/link";
import { FOCUS, Icon, cx } from "../ui/index.js";
import type { PlatformPostRow } from "../../lib/analytics/platform.js";
import { clock, fmtInt, fmtRate, shortDay, type PostSort } from "../../lib/analytics/present.js";
import { PostLead } from "./PostRows.js";

/**
 * A platform's posts in the range as a real table: post (poster, title, day), views, engagement; on
 * desktop also likes, comments and (Instagram) average watch time. The Views header links to
 * `?sort=views`; `aria-sort` says which column orders the rows.
 */
export function PostsTable({
  platform,
  posts,
  days,
  sort,
  sortHref,
}: {
  platform: Platform;
  posts: PlatformPostRow[];
  /** Local publish day per post id. */
  days: Record<string, string>;
  sort: PostSort;
  sortHref: (s: PostSort) => string;
}) {
  const watch = platform === "instagram";
  const th = "py-2 text-left text-[12px] font-semibold text-ds-muted";
  const num = "ds-num py-3 pl-3 text-right text-[15px] text-ds-text";
  return (
    <div className="-mx-4 overflow-x-auto px-4 lg:-mx-5 lg:px-5">
      <table className="w-full border-collapse">
        <caption className="sr-only">Posts in this range, {sort === "views" ? "most viewed first" : "newest first"}</caption>
        <thead>
          <tr className="border-b border-ds-line">
            <th scope="col" className={th} aria-sort={sort === "date" ? "descending" : undefined}>
              <Link href={sortHref("date")} className={cx("-ml-1 inline-flex min-h-11 items-center gap-1 rounded-ds-sm px-1 hover:text-ds-text lg:min-h-8", sort === "date" && "text-ds-text", FOCUS)}>
                Post · newest
                {sort === "date" ? <Icon name="chevronDown" size={14} /> : null}
              </Link>
            </th>
            <th scope="col" className={cx(th, "pl-3 text-right")} aria-sort={sort === "views" ? "descending" : undefined}>
              <Link href={sortHref("views")} className={cx("-mr-1 inline-flex min-h-11 items-center gap-1 rounded-ds-sm px-1 hover:text-ds-text lg:min-h-8", sort === "views" && "text-ds-text", FOCUS)}>
                Views
                {sort === "views" ? <Icon name="chevronDown" size={14} /> : null}
              </Link>
            </th>
            <th scope="col" className={cx(th, "pl-3 text-right")}>
              Eng.<span className="sr-only">agement rate</span>
            </th>
            <th scope="col" className={cx(th, "hidden pl-3 text-right lg:table-cell")}>
              Likes
            </th>
            <th scope="col" className={cx(th, "hidden pl-3 text-right lg:table-cell")}>
              Comments
            </th>
            {watch ? (
              <th scope="col" className={cx(th, "hidden pl-3 text-right lg:table-cell")}>
                Avg watch
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-ds-line">
          {posts.map((p) => (
            <tr key={p.accountPostId}>
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cx("-mx-1.5 flex min-w-0 items-center gap-3 rounded-ds-sm px-1.5 py-1 hover:bg-ds-raised", FOCUS)}
                >
                  <PostLead platform={platform} mediaId={p.mediaId} title={p.title} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ds-text">{p.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-muted">
                      <span className="ds-num">{shortDay(days[p.accountPostId] ?? p.publishedAt.slice(0, 10))}</span>
                      {p.durationS != null ? <span className="ds-num">· {clock(p.durationS)}</span> : null}
                      {p.byHand ? <span>· Posted by hand</span> : null}
                    </span>
                  </span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </th>
              <td className={cx(num, "font-semibold")}>{fmtInt(p.views) ?? "–"}</td>
              <td className={num}>{fmtRate(p.engagementRate) ?? "–"}</td>
              <td className={cx(num, "hidden lg:table-cell")}>{fmtInt(p.likes) ?? "–"}</td>
              <td className={cx(num, "hidden lg:table-cell")}>{fmtInt(p.comments) ?? "–"}</td>
              {watch ? <td className={cx(num, "hidden lg:table-cell")}>{clock(p.avgWatchS) ?? "–"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
