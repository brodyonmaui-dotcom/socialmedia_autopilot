import { PLATFORMS } from "@autopilot/core";
import { AppFrame } from "../../components/AppFrame.js";
import { Button, ButtonLink, Card, ConfirmSheet, InlineNotice, Input, PageHeader, PLATFORM_NAME, PlatformLogo, ThemeToggle } from "../../components/ui/index.js";
import { getTheme } from "../../components/ui/theme-server.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { capHelper } from "../../lib/settings/view.js";
import { loadCaps } from "../../lib/settings/caps.js";
import { logoutEverywhereAction } from "../login/actions.js";
import { saveCapsAction } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

/**
 * Settings (moved from /more/settings; light v3 restyle — a later task rebuilds it per ui-system.md).
 * Daily posts per platform (cadence.dailyCaps), appearance, notifications link, and "Log out everywhere".
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const [caps, theme] = await Promise.all([loadCaps(getPool()), getTheme()]);
  const error = param(sp.error);
  const note = param(sp.note);

  return (
    <AppFrame active="settings">
      <PageHeader title="Settings" subtitle="Posting limits, appearance and this account." />
      {error ? (
        <InlineNotice tone="danger" live className="mb-4">
          {error}
        </InlineNotice>
      ) : note ? (
        <InlineNotice live className="mb-4">
          {note}
        </InlineNotice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <Card title="Daily posts per platform" titleId="caps" subtitle="Default 5: about 3 planned for the week and 2 same-day. Scheduled posts don't move." className="lg:col-span-8">
          <form action={saveCapsAction} aria-labelledby="caps" className="flex flex-col">
            <ul className="flex flex-col divide-y divide-ds-line">
              {PLATFORMS.map((p) => (
                <li key={p} className="flex items-start gap-4 py-4 first:pt-0">
                  <span className="flex min-h-11 w-8 shrink-0 items-center" aria-hidden="true">
                    <PlatformLogo platform={p} size={22} />
                  </span>
                  <Input
                    className="min-w-0 flex-1"
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
            <div className="flex flex-col gap-3 border-t border-ds-line pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ds-muted">Each change is logged under Notifications · Acknowledged.</p>
              <Button type="submit" variant="solid">
                Save limits
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-3 lg:col-span-4 lg:gap-4">
          <Card title="Appearance">
            <ThemeToggle initial={theme} variant="row" />
          </Card>
          <Card title="Notifications" subtitle="Push alerts on this phone, and the full list.">
            <ButtonLink href="/notifications#push" variant="outline" size="sm">
              Open notifications
            </ButtonLink>
          </Card>
          <Card title="Security" subtitle="Lost a phone? This signs out every device, revokes every passkey and turns off push everywhere.">
            <ConfirmSheet
              triggerLabel="Log out everywhere"
              triggerVariant="outline"
              triggerTone="danger"
              title="Log out everywhere?"
              body="Every device is signed out and every passkey is revoked. You'll need to enrol again on the server afterwards."
              confirmLabel="Log out everywhere"
              formAction={logoutEverywhereAction}
            />
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
