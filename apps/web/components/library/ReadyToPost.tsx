import { getPool } from "../../lib/db.js";
import { loadReadyToPost } from "../../lib/library/ready-to-post.js";
import { EmptyState } from "../ui/index.js";
import { ReadyToPostForm } from "./ReadyToPostForm.js";

/**
 * "Ready to post": clips from uploads finished in the last 7 days with nothing on the calendar yet. Server component:
 * it loads the clips and hands them to the form (caption, title, platforms, confirm, Approve & schedule).
 */
export async function ReadyToPost({ now = new Date() }: { now?: Date }) {
  const clips = await loadReadyToPost(getPool(), now);
  return (
    <section aria-labelledby="ready-title" className="mt-8 lg:mt-10">
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
