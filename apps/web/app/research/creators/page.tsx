import { listCreators } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { addCreatorAction, toggleCreatorAction } from "../actions.js";
import { Badge, Button, CONTAINER, EmptyState, Input, ListRow, ListRows, Select, SectionHead, cx } from "../../../components/ui/index.js";
import { creatorPlatform, creatorSubtitle, plural } from "../../../lib/research/view.js";
import { errorFrom, FormBand, PillarSelect, ResearchFrame, type SearchParams } from "../ui.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creators · runmysocials" };

export default async function CreatorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const error = await errorFrom(searchParams);
  const creators = await listCreators(getPool());

  return (
    <ResearchFrame current="creators" error={error}>
      <FormBand title="Follow a creator" note="Public handles only. Notes say why you follow them, never where they are." action={addCreatorAction}>
        <Select label="Platform" name="platform" defaultValue="instagram">
          <option value="instagram">instagram</option>
          <option value="tiktok">tiktok</option>
          <option value="youtube">youtube</option>
          <option value="snapchat">snapchat</option>
        </Select>
        <Input label="Handle" name="handle" required placeholder="@handle or profile link" autoCapitalize="none" />
        <PillarSelect />
        <Input label="Followers" name="followers" inputMode="numeric" placeholder="optional" />
        <Input label="Why" name="notes" maxLength={500} placeholder="e.g. great deadpan hooks" className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <Button type="submit" variant="solid" arrow>
            Save
          </Button>
        </div>
      </FormBand>
      <SectionHead index="01" title="Tracked" serif="creators" meta={plural(creators.length, "creator")} />
      <div className={cx(CONTAINER, "-mt-px pb-10")}>
        {creators.length === 0 ? (
          <EmptyState icon="research" title="No creators yet" body="Add a public handle above." className="border border-ds-line" />
        ) : (
          <ListRows label="Creators" className="border-t border-ds-line">
            {creators.map((c) => (
              <ListRow
                key={c.id}
                avatar={{ platform: creatorPlatform(c.platform) }}
                title={`@${c.handle}`}
                subtitle={creatorSubtitle(c)}
                trailing={c.active ? undefined : <Badge tone="neutral">Paused</Badge>}
              >
                <form action={toggleCreatorAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={String(!c.active)} />
                  <Button type="submit" variant="outline" size="sm">
                    {c.active ? "Pause" : "Resume"}
                  </Button>
                </form>
              </ListRow>
            ))}
          </ListRows>
        )}
      </div>
    </ResearchFrame>
  );
}
