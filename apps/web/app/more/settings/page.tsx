import { PLATFORMS } from "@autopilot/core";
import { AppFrame } from "../../../components/AppFrame.js";
import { loadFrameCounts } from "../../../components/frame-counts.js";
import { Button, ButtonLink, CONTAINER, Icon, Input, PLATFORM_NAME, PlatformLogo, Readout, cx } from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { capHelper } from "../../../lib/settings/view.js";
import { loadCaps } from "../../../lib/settings/caps.js";
import { Notice } from "../../batches/ui/Notice.js";
import { saveCapsAction } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · runmysocials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

/** F15 Settings: the per-platform daily cap (cadence.dailyCaps), bounded by CAP_LIMITS. */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const [counts, caps] = await Promise.all([loadFrameCounts(pool), loadCaps(pool)]);

  return (
    <AppFrame active="settings" counts={counts}>
      <header className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 gap-y-4 py-8 lg:grid-cols-12 lg:py-12")}>
          <div className="col-span-4 lg:col-span-12">
            <ButtonLink href="/more" variant="ghost" className="-ml-4">
              <Icon name="chevronLeft" size={16} />
              More
            </ButtonLink>
          </div>
          <p className="ds-mono col-span-1 text-ds-muted lg:self-end">06 /</p>
          <h1 className="col-span-3 text-[40px] font-black leading-[0.95] tracking-[-0.04em] lg:col-span-11 lg:text-[72px]">
            <span className="ds-serif font-normal">Settings</span>
          </h1>
        </div>
      </header>

      <Notice error={param(sp.error)} note={param(sp.note)} />

      <section aria-labelledby="caps" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 gap-y-6 py-8 lg:grid-cols-12 lg:py-12")}>
          <div className="col-span-4 flex flex-col gap-4 lg:col-span-4 lg:pr-10">
            <h2 id="caps" className="text-[26px] font-black leading-[0.95] tracking-[-0.04em] lg:text-[36px]">
              Daily posts per platform <span className="ds-serif font-normal">(cap)</span>
            </h2>
            <p className="ds-note">Default 5: about 3 weekly + 2 same-day. Applies to new slotting; scheduled posts don&rsquo;t move.</p>
            <Readout items={PLATFORMS.map((p) => ({ k: PLATFORM_NAME[p], v: `${caps.effective[p]} / day` }))} />
          </div>
          <form action={saveCapsAction} aria-labelledby="caps" className="col-span-4 flex flex-col lg:col-span-8 lg:border-l lg:border-ds-line lg:pl-10">
            <ul className="flex flex-col divide-y divide-ds-line border-y border-ds-line">
              {PLATFORMS.map((p) => (
                <li key={p} className="grid grid-cols-4 items-start gap-4 py-5 lg:grid-cols-8">
                  <span className="col-span-1 flex min-h-12 items-center lg:col-span-2" aria-hidden="true">
                    <PlatformLogo platform={p} size={24} />
                  </span>
                  <Input
                    className="col-span-3 lg:col-span-6"
                    label={PLATFORM_NAME[p]}
                    name={`cap-${p}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={caps.limits[p]}
                    step={1}
                    required
                    defaultValue={caps.effective[p]}
                    helper={capHelper(p, caps)}
                  />
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="ds-mono text-ds-faint">Each change is logged under Alerts · Acknowledged.</p>
              <Button type="submit" variant="solid" arrow>
                Save caps
              </Button>
            </div>
          </form>
        </div>
      </section>
    </AppFrame>
  );
}
