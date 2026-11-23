import { AppFrame } from "../../../components/AppFrame.js";
import { loadFrameCounts } from "../../../components/frame-counts.js";
import { Badge, Button, ButtonLink, Card, DataList, DataRow, EmptyState, InlineNotice, Input, PageHeader } from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { creatorZone } from "../../../lib/calendar/load.js";
import { listSounds, SOUND_RIGHTS_NOTE } from "../../../lib/reels/data.js";
import { localClock12 } from "@autopilot/core";
import { archiveSoundForm, uploadSoundForm } from "../reel-actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sounds · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DONE: Record<string, string> = {
  added: "Sound added.",
  already: "That sound was already in your library.",
  archived: "Sound archived. Reels already made keep it.",
};

/** F20 E: the sounds the reel maker can use (upload mp3/m4a/wav ≤ 15 MB to private storage; archive hides one). */
export default async function SoundsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const { timeZone } = creatorZone();
  const [counts, sounds] = await Promise.all([loadFrameCounts(pool), listSounds(pool)]);
  const done = DONE[one(sp.done) ?? ""];
  const error = one(sp.error)?.slice(0, 200);
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d)}, ${localClock12(d, timeZone)}`;
  };

  return (
    <AppFrame active="library" counts={counts}>
      <PageHeader
        title="Sounds"
        subtitle="Audio for your reels."
        action={
          <ButtonLink href="/library/reels" variant="outline">
            Reels
          </ButtonLink>
        }
      />
      {done ? (
        <InlineNotice tone="info" live className="mb-3 lg:mb-4">
          {done}
        </InlineNotice>
      ) : null}
      {error ? (
        <InlineNotice tone="danger" live className="mb-3 lg:mb-4">
          {error}
        </InlineNotice>
      ) : null}

      <Card title="Upload a sound" className="mb-4" bodyClassName="flex flex-col gap-3">
        <p className="text-[14px] font-semibold text-ds-text">{SOUND_RIGHTS_NOTE}</p>
        <form action={uploadSoundForm} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input label="Sound file (mp3, m4a or wav, up to 15 MB)" name="file" type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" required className="min-w-0 flex-1" />
          <Input label="Name (optional)" name="name" maxLength={80} autoComplete="off" className="min-w-0 sm:w-[220px]" />
          <Button type="submit" variant="solid">
            Upload
          </Button>
        </form>
      </Card>

      {sounds.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <EmptyState icon="play" title="No sounds yet" body="Upload a track you own or that's royalty-free, then use it in Make a reel." />
        </div>
      ) : (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card px-3">
          <DataList label="Sounds">
            {sounds.map((s) => (
              <DataRow
                key={s.id}
                icon="play"
                title={s.name}
                meta={`Added ${when(s.createdAt)}`}
                trailing={
                  <form action={archiveSoundForm}>
                    <input type="hidden" name="soundId" value={s.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Archive
                    </Button>
                  </form>
                }
              />
            ))}
          </DataList>
        </div>
      )}
      <p className="ds-helper mt-3">
        <Badge>Private</Badge> Sounds are stored privately and never posted on their own.
      </p>
    </AppFrame>
  );
}
