import { blocklistFromEnv, classifyHook, lintText, listHooks } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { addHookAction } from "../actions.js";
import { Badge, Button, CONTAINER, Chip, EmptyState, Input, RevealList, Select, SectionHead, cx, type RevealItem } from "../../../components/ui/index.js";
import { hookMeta, plural, two } from "../../../lib/research/view.js";
import { errorFrom, FormBand, PillarSelect, ResearchFrame, type SearchParams } from "../ui.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hooks · runmysocials" };

export default async function HooksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const error = await errorFrom(searchParams);
  const hooks = await listHooks(getPool());
  const blocklist = blocklistFromEnv();

  const flagged: { id: string; text: string; messages: string[] }[] = [];
  const items: RevealItem[] = hooks.map((h, n) => {
    const warnings = lintText({ text: h.text, kind: "hook", pillar: h.pillar, blocklist }).issues;
    if (warnings.length > 0) flagged.push({ id: h.id, text: h.text, messages: warnings.map((w) => w.message) });
    return {
      id: h.id,
      index: two(n + 1),
      title: h.text,
      meta: hookMeta(h, classifyHook(h.text)),
      trailing: warnings.length > 0 ? <Badge tone="warn">{plural(warnings.length, "warning")}</Badge> : <Badge tone={h.source === "own" ? "neutral" : "accent"}>{h.source === "own" ? "Mine" : "Creator"}</Badge>,
    };
  });

  return (
    <ResearchFrame current="hooks" error={error}>
      <FormBand title="Add a hook" note="Least-used first. Voice warnings come from docs/voice.md." action={addHookAction}>
        <Input label="Hook" name="text" required maxLength={200} placeholder="My lats are not a fan of this…" className="sm:col-span-2" />
        <PillarSelect />
        <Select label="Source" name="source" defaultValue="own">
          <option value="own">mine</option>
          <option value="creator">from a creator</option>
        </Select>
        <div className="sm:col-span-2">
          <Button type="submit" variant="solid" arrow>
            Add hook
          </Button>
        </div>
      </FormBand>
      <SectionHead index="01" title="Hook" serif="bank" meta={plural(hooks.length, "hook")} />
      <div className={cx(CONTAINER, "-mt-px pb-10")}>
        {items.length === 0 ? (
          <EmptyState icon="research" title="No hooks yet" body="Add your first opening line above." className="border border-ds-line" />
        ) : (
          <RevealList label="Hooks" items={items} />
        )}
      </div>
      {flagged.length > 0 ? (
        <>
          <SectionHead index="02" title="Voice" serif="warnings" meta={plural(flagged.length, "hook")} />
          <div className={cx(CONTAINER, "-mt-px flex flex-col gap-3 pb-10 pt-6")}>
            {flagged.map((f) => (
              <Chip key={f.id} wrap tone="warn" className="flex w-full">
                <span className="font-bold">{f.text}: </span>
                {f.messages.join(" · ")}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
    </ResearchFrame>
  );
}
