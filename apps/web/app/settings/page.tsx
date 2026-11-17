import { PLATFORMS } from "@autopilot/core";
import { AppFrame } from "../../components/AppFrame.js";
import { DmDraftsSwitch, ModeRow, PauseSwitch } from "../../components/settings/ReplyControls.js";
import {
  Button,
  ButtonLink,
  Card,
  CardLink,
  ConfirmSheet,
  DataList,
  DataRow,
  EmptyState,
  InlineNotice,
  PageHeader,
  PLATFORM_NAME,
  PlatformLogo,
  SegmentBar,
  SegmentButton,
  Stepper,
  ThemeToggle,
} from "../../components/ui/index.js";
import { getTheme } from "../../components/ui/theme-server.js";
import { requireSession } from "../../lib/auth/require.js";
import { creatorZone } from "../../lib/calendar/load.js";
import { getPool } from "../../lib/db.js";
import { loadEngagement } from "../../lib/engagement/settings.js";
import { loadPromoAccounts } from "../../lib/inbox/promo.js";
import { inboxHref } from "../../lib/inbox/view.js";
import { countActiveSubscriptions } from "../../lib/push/subscriptions.js";
import { loadResearchStatus } from "../../lib/research/ideas.js";
import { loadCaps } from "../../lib/settings/caps.js";
import { aiNotesLine, lastRunLine, PING_LABEL, PINGS, REPLY_PLATFORMS, shortDate, zoneNotice } from "../../lib/settings/replies.js";
import { capHelper } from "../../lib/settings/view.js";
import { EnablePush } from "../../components/notifications/EnablePush.js";
import { isVapidPublicKey } from "../../components/notifications/push-client.js";
import { logoutEverywhereAction, removePromoAccountAction, saveCapsAction, setPingsAction } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

const handle = (h: string | null) => (h ? `@${h.replace(/^@+/, "")}` : "Unknown account");

/**
 * Settings (v3): daily posts per platform, replies (pause all, per-platform mode, DM drafts, pings),
 * the always-ignore list, research, notifications, appearance and security. Anything that changes what
 * goes public or costs money says "needs your OK in chat" instead of offering a live control.
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const zone = creatorZone();
  const [caps, theme, engagement, promo, research, devices] = await Promise.all([
    loadCaps(pool),
    getTheme(),
    loadEngagement(pool),
    loadPromoAccounts(pool),
    loadResearchStatus(pool),
    countActiveSubscriptions(pool),
  ]);
  // Runtime env (not NEXT_PUBLIC_*): the public key is safe to send; the private key never leaves the worker.
  const vapid = process.env.VAPID_PUBLIC_KEY?.trim();
  const kill = (process.env.ENGAGEMENT_KILL ?? "").trim().toLowerCase();
  const envPaused = kill === "1" || kill === "true";
  const error = param(sp.error);
  const note = param(sp.note);
  const tzNote = zoneNotice(zone.source);
  const budget = research.aiNotes.monthlyBudgetTokens.toLocaleString("en-US");

  return (
    <AppFrame active="settings">
      <PageHeader title="Settings" subtitle="Posting limits, replies, notifications and this account." />

      {error ? (
        <InlineNotice tone="danger" live className="mb-3 lg:mb-4">
          {error}
        </InlineNotice>
      ) : note ? (
        <InlineNotice live className="mb-3 lg:mb-4">
          {note}
        </InlineNotice>
      ) : null}
      {tzNote ? (
        <InlineNotice tone="warn" className="mb-3 lg:mb-4">
          {tzNote}
        </InlineNotice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <Card title="Daily posts" titleId="caps" subtitle="The most posts a day for each platform. Posts already scheduled don't move." className="scroll-mt-20 lg:col-span-6">
          <form action={saveCapsAction} aria-labelledby="caps" className="flex flex-1 flex-col">
            <ul className="flex flex-col divide-y divide-ds-line">
              {PLATFORMS.map((p) => (
                <li key={p} className="flex items-center gap-3 py-3 first:pt-0">
                  <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
                    <PlatformLogo platform={p} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ds-text">{PLATFORM_NAME[p]}</span>
                    <span className="block text-[13px] text-ds-muted">{capHelper(p, caps)}</span>
                  </span>
                  <Stepper label={`${PLATFORM_NAME[p]} posts a day`} name={`cap-${p}`} min={0} max={caps.limits[p]} defaultValue={caps.effective[p]} />
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-line pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ds-muted">Each change is logged under Notifications.</p>
              <Button type="submit" variant="solid">
                Save limits
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Replies" titleId="replies" subtitle="How each platform answers comments." action={<CardLink href="/inbox">Inbox</CardLink>} className="scroll-mt-20 lg:col-span-6">
          <div className="flex flex-col divide-y divide-ds-line">
            <div className="pb-3">
              <PauseSwitch paused={engagement.killed} reason={engagement.killedReason} envPaused={envPaused} />
            </div>
            <ul aria-label="Reply mode per platform" className="flex flex-col divide-y divide-ds-line py-4">
              {REPLY_PLATFORMS.map((p) => (
                <ModeRow key={p} platform={p} mode={engagement.mode[p]} />
              ))}
            </ul>
            <div className="py-3">
              <DmDraftsSwitch on={engagement.dmPollVerified} />
            </div>
            <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ds-text">Reply pings</p>
                <p className="text-[13px] leading-snug text-ds-muted">A phone notification when a comment needs you.</p>
              </div>
              <form className="w-full sm:w-auto sm:min-w-[316px]">
                <SegmentBar ariaLabel="Reply pings">
                  {PINGS.map((m) =>
                    m === engagement.pings ? (
                      <SegmentButton className="whitespace-nowrap px-2" key={m} active type="button">
                        {PING_LABEL[m]}
                      </SegmentButton>
                    ) : (
                      <SegmentButton className="whitespace-nowrap px-2" key={m} active={false} name="pings" value={m} formAction={setPingsAction}>
                        {PING_LABEL[m]}
                      </SegmentButton>
                    ),
                  )}
                </SegmentBar>
              </form>
            </div>
          </div>
        </Card>

        <Card
          title="Always ignored"
          titleId="promo"
          subtitle={promo.length === 0 ? "Promo accounts the inbox skips." : promo.length === 1 ? "1 promo account the inbox skips." : `${promo.length} promo accounts the inbox skips.`}
          action={promo.length ? <CardLink href={inboxHref("comments", "ignored")}>Ignored</CardLink> : undefined}
          className="scroll-mt-20 lg:col-span-6"
        >
          {promo.length === 0 ? (
            <EmptyState
              icon="message"
              title="No accounts yet"
              body="Pick “Always ignore this account” on a promo comment and it's listed here."
              action={
                <ButtonLink href={inboxHref("comments", "ignored")} variant="outline" size="sm">
                  Open ignored comments
                </ButtonLink>
              }
              className="flex-1 justify-center py-2"
            />
          ) : (
            <>
              <DataList label="Accounts the inbox always ignores">
                {promo.map((a) => (
                  <DataRow
                    key={a.id}
                    leading={
                      <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
                        <PlatformLogo platform={a.platform} size={18} />
                      </span>
                    }
                    title={handle(a.displayHandle)}
                    meta={`${a.source === "rule" ? "Added by a rule" : "Added by you"} · ${shortDate(a.createdAt, zone.timeZone)}`}
                    trailing={
                      <form action={removePromoAccountAction.bind(null, a.id)}>
                        <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${handle(a.displayHandle)} from the list`}>
                          Remove
                        </Button>
                      </form>
                    }
                  />
                ))}
              </DataList>
              <p className="mt-4 text-[13px] leading-snug text-ds-muted">To add one, pick &ldquo;Always ignore this account&rdquo; on a comment in the inbox.</p>
            </>
          )}
        </Card>

        <Card title="Research" titleId="research" subtitle="Fresh ideas from the creators you follow." action={<CardLink href="/research/creators">Creators</CardLink>} className="scroll-mt-20 lg:col-span-6">
          <DataList label="Research schedule">
            <DataRow icon="calendar" title="Refresh" meta={`Every 3 days · next ${shortDate(research.nextRunAt, zone.timeZone)}`} wrapMeta />
            <DataRow icon="research" title="Last refresh" meta={lastRunLine(research.lastRun, zone.timeZone)} wrapMeta />
            <DataRow icon="star" title="AI notes" meta={aiNotesLine(research.aiNotes)} wrapMeta />
          </DataList>
          <p className="mt-4 text-[13px] leading-snug text-ds-muted">
            AI notes add a short &ldquo;why it works&rdquo; to each idea. They cost money, so they stay off until you OK it in chat (budget {budget} tokens a month).
          </p>
        </Card>

        <div className="scroll-mt-20 lg:col-span-8" id="push">
          <EnablePush vapidPublicKey={isVapidPublicKey(vapid) ? vapid : null} activeCount={devices} />
        </div>

        <div className="flex flex-col gap-3 lg:col-span-4 lg:gap-4">
          <Card title="Appearance" titleId="appearance">
            <ThemeToggle initial={theme} variant="row" />
          </Card>
          <Card title="Security" titleId="security" subtitle="Lost a phone? Sign out every device at once.">
            <ConfirmSheet
              triggerLabel="Log out everywhere"
              triggerVariant="outline"
              triggerTone="danger"
              triggerClassName="w-full sm:w-auto"
              title="Log out everywhere?"
              body={
                <div className="flex flex-col gap-3">
                  <p>Every device is signed out, this one too. Your passkey stays, so you sign back in with it as usual.</p>
                  <p>Lost the phone itself? Also remove its passkey on the server: see the login runbook.</p>
                </div>
              }
              confirmLabel="Log out everywhere"
              formAction={logoutEverywhereAction}
            />
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
