// F10 Snapchat handoff (assisted route). Shared between the store (server) and the page/UI.
// Contract owned by the lead; see docs/design/F10.md.

export type HandoffBucket = "today" | "missed" | "future";

export interface HandoffItem {
  id: string;
  batchId: string;
  mediaId: string;
  label: string;
  durationS?: number;
  scheduledFor: string; // ISO UTC
  localDay: string; // YYYY-MM-DD in the creator's zone
  bucket: "today" | "missed";
  caption: string; // snapchatCaption(bi.caption)
  checklist: string[]; // SNAPCHAT_CHECKLIST
  hasCleanFile: boolean; // r2_key not null
  blocks: string[]; // lint privacy errors + "no clean file"; non-empty → Share disabled
}

export interface HandoffList {
  today: HandoffItem[];
  missed: HandoffItem[];
}

export type ActionResult = { ok: true; to?: string } | { ok: false; reason: string };
