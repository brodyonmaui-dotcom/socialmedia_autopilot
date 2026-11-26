import { getPool } from "../../lib/db.js";
import { loadReadyToPost } from "../../lib/library/ready-to-post.js";
import { EmptyState, InlineNotice } from "../ui/index.js";
import { ReadyToPostForm } from "./ReadyToPostForm.js";

/**
 * "Ready to post": clips from uploads finished in the last 7 days with nothing on the calendar yet. Server component:
 * it loads the clips and hands them to the form (caption, title, platforms, confirm, Approve & schedule).
 */
export async function ReadyToPost({ now = new Date() }: { now?: Date }) {
  // Never take the Upload page down with it: a failed load shows a notice instead.
  const clips = await loadReadyToPost(getPool(), now).catch((e: unknown) => {
    console.error("ready-to-post: load failed", e instanceof Error ? e.message : e);
    return null;
  });
  if (clips === null)
    return (
      <section id="ready" className="mt-8 lg:mt-10">
        <InlineNotice tone="danger">Ready to post couldn&apos;t load. If you just deployed, apply migration 0017 (docs/runbooks/uploads.md).</InlineNotice>
      </section>
    );
  return (
    <section id="ready" aria-labelledby="ready-title" className="mt-8 scroll-mt-20 lg:mt-10">
      <div className="mb-3 flex items-baseline gap-2 lg:mb-4">
        <h2 id="ready-title" className="ds-heading text-ds-text">
          Ready to post
        </h2>
        <span className="ds-num text-[15px] text-ds-muted">{clips.length}</span>
      </div>
      {clips.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <EmptyState icon="film" title="Nothing waiting" body="Clips you upload show up here once they're processed, until they're on the calendar." />
        </div>
      ) : (
        <ReadyToPostForm clips={clips} />
      )}
    </section>
  );
}
