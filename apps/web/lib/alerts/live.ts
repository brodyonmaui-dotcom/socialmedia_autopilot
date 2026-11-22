// F20: the Inbox is the work, notifications are events. This turns the Inbox's per-platform groups into the
// "live" rows shown first in the pop-over and on /notifications (pure; tested in __tests__/live.test.ts).
import { sourceLabel } from "./queries.js";
import { plural } from "./view.js";
import type { InboxGroup } from "../inbox/groups.js";

export interface LiveRow {
  id: string;
  platform: string;
  /** Plain sentence. */
  title: string;
  /** The whole row links here. */
  href: string;
  /** The button text ("Review replies"). */
  action: string;
  /** ISO: how long it has been waiting (the newest item of the group). */
  at: string | null;
}

const who = (h: string | null) => (h ? `@${h.replace(/^@+/, "")}` : "someone");
const quote = (t: string) => (t ? `: “${t.length > 40 ? `${t.slice(0, 39)}…` : t}”` : "");

/** Per platform: a drafted-replies row, a needs-you row (or the one comment itself), a DM row. Newest first. */
export function liveRows(groups: readonly InboxGroup[]): LiveRow[] {
  const rows: LiveRow[] = [];
  for (const g of groups) {
    const name = sourceLabel(g.platform);
    const q = (filter: string) => `/inbox?filter=${filter}&platform=${g.platform}`;
    const comments = g.drafted + g.needsYou;
    if (comments === 1 && g.newest) {
      rows.push({
        id: `comment-${g.newest.id}`,
        platform: g.platform,
        title: `Comment from ${who(g.newest.authorHandle)}${quote(g.newest.text)}`,
        href: `/inbox/item/${g.newest.id}`,
        action: g.drafted === 1 ? "Review reply" : "Reply",
        at: g.newest.at,
      });
    } else {
      if (g.drafted > 0) rows.push({ id: `drafted-${g.platform}`, platform: g.platform, title: `${plural(g.drafted, "reply", "replies")} drafted to your ${name} comments`, href: q("drafted"), action: "Review replies", at: g.newest?.at ?? null });
      if (g.needsYou > 0) rows.push({ id: `needs-${g.platform}`, platform: g.platform, title: `${plural(g.needsYou, `${name} comment`, `${name} comments`)} ${g.needsYou === 1 ? "needs" : "need"} you`, href: q("needs-you"), action: "Open comments", at: g.newest?.at ?? null });
    }
    if (g.dmsOpen > 0) {
      rows.push({
        id: `dms-${g.platform}`,
        platform: g.platform,
        title: g.dmsOpen === 1 && g.newestDm ? `DM from ${who(g.newestDm.authorHandle)}` : `${plural(g.dmsOpen, `${name} DM`)} waiting`,
        href: "/inbox/dms",
        action: "Open DMs",
        at: g.newestDm?.at ?? null,
      });
    }
  }
  return rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
