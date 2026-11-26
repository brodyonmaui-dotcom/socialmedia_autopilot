import { AppFrame } from "../../components/AppFrame.js";
import { loadFrameCounts } from "../../components/frame-counts.js";
import { StudioEditor } from "../../components/studio/StudioEditor.js";
import { PageHeader } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { loadSounds, loadStudioClips } from "../../lib/studio/data.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · My Socials" };

/** F24: cut clips together, add text and a sound, export a 9:16 video that lands in Ready to post. */
export default async function StudioPage() {
  await requireSession();
  const pool = getPool();
  const [counts, clips, sounds] = await Promise.all([loadFrameCounts(pool).catch(() => ({})), loadStudioClips(pool), loadSounds(pool)]);
  return (
    <AppFrame active="studio" counts={counts}>
      <PageHeader title="Studio" subtitle="Trim, join, caption and score your clips. The result waits in Ready to post." />
      <StudioEditor
        clips={clips.filter((c) => c.durationS != null && c.durationS > 0).map((c) => ({ mediaId: c.mediaId, name: c.name, folder: c.folder ?? null, durationS: c.durationS as number, hasAudio: c.hasAudio }))}
        sounds={sounds.map((s) => ({ id: s.id, name: s.name, durationS: s.durationS }))}
      />
    </AppFrame>
  );
}
