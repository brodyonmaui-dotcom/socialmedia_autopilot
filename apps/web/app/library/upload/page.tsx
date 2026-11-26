import { AppFrame } from "../../../components/AppFrame.js";
import { loadFrameCounts } from "../../../components/frame-counts.js";
import { ReadyToPost } from "../../../components/library/ReadyToPost.js";
import { Uploader } from "../../../components/library/Uploader.js";
import { ButtonLink, InlineNotice, PageHeader } from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Upload · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 300);

/** F23: upload videos or a folder, then caption them and Approve & schedule. */
export default async function UploadPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const note = first(sp.note);
  const error = first(sp.error);
  const counts = await loadFrameCounts(getPool()).catch(() => ({}));
  return (
    <AppFrame active="library/upload" counts={counts}>
      <PageHeader
        title="Upload"
        subtitle="Drop finished videos or a whole folder. They land in your Library, ready to caption and schedule."
        back={{ href: "/library", label: "Library" }}
        action={
          <ButtonLink href="/library" variant="outline">
            Open the library
          </ButtonLink>
        }
      />
      {error ? (
        <InlineNotice tone="danger" live className="mb-3 lg:mb-4">
          {error}
        </InlineNotice>
      ) : note ? (
        <InlineNotice live className="mb-3 lg:mb-4" href="/calendar" linkLabel="Open the calendar">
          {note}
        </InlineNotice>
      ) : null}
      <Uploader />
      <ReadyToPost />
    </AppFrame>
  );
}
