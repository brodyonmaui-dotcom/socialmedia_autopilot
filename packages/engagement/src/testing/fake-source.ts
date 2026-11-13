// Scripted CommentSource for tests and scripts/simulate-engagement.ts. Sends nothing anywhere.

import { NonRetryableError } from "@autopilot/core";
import type { CommentSource, EngagementPlatform, InboundComment } from "../types.js";

/**
 * Per-comment behaviour of `reply`/`hide`:
 *  - `ok`: resolves (reply returns `{ platformReplyId: "reply-<n>" }`)
 *  - `reject`: throws Error("bad request") (retryable)
 *  - `permanent`: throws NonRetryableError
 *  - `timeout`: never resolves until the signal aborts, then rejects with the abort reason
 *  - `block`: throws Error("Action Blocked: spam") (trips the kill switch)
 */
export type FakeBehaviour = "ok" | "reject" | "permanent" | "timeout" | "block";

export interface FakeSourceOptions {
  /** Script per platformCommentId: a single behaviour, or a list consumed one per call (the last one repeats). Default "ok". */
  behaviours?: Record<string, FakeBehaviour | FakeBehaviour[]>;
  /** fetchThread results per platformCommentId (an explicit null = comment gone). */
  threads?: Record<string, InboundComment | null>;
  /** What fetchThread returns for ids not in `threads`: "gone" (null, default) or "empty" (a thread with no own replies). */
  missingThread?: "gone" | "empty";
  /** Omit a capability to test "no-capability" (both default true). */
  canReply?: boolean;
  canHide?: boolean;
  /** Error message for `reject` (default "bad request"), e.g. to test redaction. */
  rejectMessage?: string;
}

/**
 * `FakeCommentSource` — every reply/hide call is recorded in `calls`; every fetchThread in `threadCalls`.
 * `behaviours` and `threads` are public maps so a test can change the script between ticks.
 */
export class FakeCommentSource implements CommentSource {
  readonly platform: EngagementPlatform;
  behaviours: Map<string, FakeBehaviour | FakeBehaviour[]>;
  threads: Map<string, InboundComment | null>;
  calls: Array<{ op: "reply" | "hide"; platformCommentId: string; text?: string; idempotencyKey?: string }> = [];
  threadCalls: string[] = [];
  rejectMessage: string;
  missingThread: "gone" | "empty";
  reply?: CommentSource["reply"];
  hide?: CommentSource["hide"];
  private n = 0;

  constructor(platform: EngagementPlatform, opts: FakeSourceOptions = {}) {
    this.platform = platform;
    this.behaviours = new Map(Object.entries(opts.behaviours ?? {}));
    this.threads = new Map(Object.entries(opts.threads ?? {}));
    this.rejectMessage = opts.rejectMessage ?? "bad request";
    this.missingThread = opts.missingThread ?? "gone";
    if (opts.canReply !== false) {
      this.reply = async (platformCommentId, text, o) => {
        this.calls.push({ op: "reply", platformCommentId, text, idempotencyKey: o.idempotencyKey });
        await this.act(platformCommentId, o.signal);
        return { platformReplyId: `reply-${++this.n}` };
      };
    }
    if (opts.canHide !== false) {
      this.hide = async (platformCommentId, o) => {
        this.calls.push({ op: "hide", platformCommentId });
        await this.act(platformCommentId, o?.signal);
      };
    }
  }

  async fetchRecent(cursor: unknown): Promise<{ comments: InboundComment[]; cursor: unknown }> {
    return { comments: [], cursor };
  }

  async fetchThread(platformCommentId: string): Promise<InboundComment | null> {
    this.threadCalls.push(platformCommentId);
    if (this.threads.has(platformCommentId)) return this.threads.get(platformCommentId) ?? null;
    return this.missingThread === "empty" ? fakeThread(this.platform, platformCommentId) : null;
  }

  private next(id: string): FakeBehaviour {
    const b = this.behaviours.get(id);
    if (b === undefined) return "ok";
    if (typeof b === "string") return b;
    const head = b.length > 1 ? b.shift() : b[0];
    return head ?? "ok";
  }

  private act(id: string, signal?: AbortSignal): Promise<void> {
    switch (this.next(id)) {
      case "ok":
        return Promise.resolve();
      case "reject":
        return Promise.reject(new Error(this.rejectMessage));
      case "permanent":
        return Promise.reject(new NonRetryableError("permission denied"));
      case "block":
        return Promise.reject(new Error("Action Blocked: spam"));
      case "timeout":
        return new Promise<void>((_, reject) => {
          if (!signal) return; // never settles without a signal
          const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
    }
  }
}

/** Build an InboundComment for `threads` with sane defaults. */
export function fakeThread(platform: EngagementPlatform, platformCommentId: string, own: Array<{ id: string; text: string }> = []): InboundComment {
  return {
    platform,
    platformCommentId,
    platformMediaId: "media-1",
    authorId: "someone",
    text: "love this",
    createdAt: new Date(0).toISOString(),
    isOwn: false,
    ownRepliesInThread: own.map((o) => ({ platformCommentId: o.id, text: o.text, createdAt: new Date(0).toISOString() })),
  };
}
