import type { Platform } from "@autopilot/core";
import type { BatchView, ItemStatus } from "./types.js";
import type { ItemChange } from "./transitions.js";

export interface BatchSummary {
  id: string;
  weekStart: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  counts: Record<ItemStatus, number>;
  blockedCount?: number;
}

/** A conditional update matched nothing: someone (worker, CLI, another tab) changed the row first. */
export class ConflictError extends Error {
  constructor(message = "changed underneath you, reload") {
    super(message);
    this.name = "ConflictError";
  }
}

export interface LibraryMedia {
  id: string;
  label: string;
  pillar: string | null;
  durationS: number | null;
  hasCleanFile: boolean;
}

export interface BatchStore {
  /** Newest week first. */
  listBatches(limit?: number): Promise<BatchSummary[]>;
  /** Items come with warnings: [] (the caller fills them); editable/handedOff via deriveFlags; counts via countByStatus. */
  loadBatch(id: string): Promise<BatchView | null>;
  /** All changes + their audit events + the batch status in one transaction; ConflictError rolls back everything. */
  apply(batchId: string, changes: ItemChange[], batchStatus: "draft" | "approved", sessionId: string | null, now: Date): Promise<void>;
  /** New draft item (caption '', no title, no time) + an 'add' event. Refuses an unknown batch or media. */
  addItem(batchId: string, mediaId: string, platform: Platform, sessionId: string | null, now: Date): Promise<string>;
  /** Library clips for the "add clip" picker, newest first. */
  listLibraryMedia(limit?: number): Promise<LibraryMedia[]>;
}
