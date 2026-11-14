import { AppFrame } from "../../components/AppFrame.js";
import { CONTAINER, Display, EmptyState, FooterBand, Readout, SectionHead, StatusPulse, TabLinks, cx } from "../../components/ui/index.js";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { ACK_WINDOW_DAYS, countByKind, listAlerts, parseKind, parseState } from "../../lib/alerts/queries.js";
import { ackAllCopy, heroLines, kindTabs, listHead, plural, pulseFor, splitUrgent, stateTabs, total } from "../../lib/alerts/view.js";
import { relativeTime } from "../../lib/engagement/queries.js";
import { countActiveSubscriptions } from "../../lib/push/subscriptions.js";
import { AckAllSheet } from "./ui/AckAllSheet.js";
import { AlertCard } from "./ui/AlertCard.js";
import { EnablePush } from "./ui/EnablePush.js";
import { isVapidPublicKey } from "./ui/push-client.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const footer = (
  <FooterBand link={{ href: "/batches", label: "Batches", sub: "Failed and unknown posts are fixed from their batch" }} status="Alerts · page + push" meta="runmysocials · approval first" />
);

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const state = parseState(sp.state);
  const kind = parseKind(sp.kind); // unknown value → unfiltered
  const pool = getPool();
  const now = new Date();
  const [counts, openCounts, alerts, devices] = await Promise.all([
    countByKind(pool, state, now),
    state === "open" ? null : countByKind(pool, "open", now),
    listAlerts(pool, { state, kind, now }),
    countActiveSubscriptions(pool),
  ]);
  // Runtime env (not NEXT_PUBLIC_*): the public key is safe to send; the private key never leaves the worker.
  const vapid = process.env.VAPID_PUBLIC_KEY?.trim();
  const open = openCounts ?? counts;
  const openTotal = total(open);
  const split = splitUrgent(open);
  const pulse = pulseFor(open);
  const head = listHead(state, alerts.length, kind, ACK_WINDOW_DAYS);
  // "Acknowledge all" sends exactly the ids rendered below (alerts that arrive later stay open).
  const shownIds = state === "open" ? alerts.map((a) => a.id) : [];
  const copy = ackAllCopy(shownIds.length, kind);

  return (
    <AppFrame active="alerts" footer={footer}>
      {/* Hero: open count */}
      <section aria-label="Open alerts" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-3">
              <StatusPulse tone={pulse.tone} label={pulse.label} />
              <span className="ds-mono text-ds-faint">F8 / ALERTS</span>
            </div>
            <Display lines={heroLines(openTotal)} />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-6 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:py-16 lg:pl-10">
            <p className="text-[20px] font-bold leading-tight tracking-[-0.02em]">Anything that needs you lands here first.</p>
            <p className="ds-note">Acknowledge moves an alert to the Acknowledged tab. Nothing is deleted, and nothing here posts or retries.</p>
            <Readout
              items={[
                { k: "Urgent", v: plural(split.urgent, "alert") },
                { k: "Notices", v: plural(split.info, "alert") },
                { k: "Kept", v: `${ACK_WINDOW_DAYS} days after ack` },
                { k: "Push", v: plural(devices, "device") },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Filters */}
      <section aria-label="Filter alerts" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "flex flex-col gap-3 py-6 lg:py-8")}>
          <TabLinks ariaLabel="Alert state" items={stateTabs(state, openTotal)} />
          {total(counts) > 0 || kind ? <TabLinks ariaLabel="Filter by kind" layout="grid" items={kindTabs(state, kind, counts)} /> : null}
        </div>
      </section>

      <section aria-labelledby="alerts-list">
        <SectionHead index={head.index} title={head.title} serif={head.serif} meta={head.meta} id="alerts-list" />
        {alerts.length === 0 ? (
          <div className={cx(CONTAINER, "border-b border-ds-line")}>
            <EmptyState
              icon={state === "open" ? "check" : "bell"}
              title={state === "open" ? "No open alerts" : "Nothing acknowledged recently"}
              body={state === "open" ? "Anything that needs you shows up here." : `Acknowledged alerts stay here for ${ACK_WINDOW_DAYS} days.`}
              className="py-16"
            />
          </div>
        ) : (
          <>
            {shownIds.length > 0 ? (
              <div className={cx(CONTAINER, "grid grid-cols-4 border-b border-ds-line lg:grid-cols-12")}>
                <AckAllSheet ids={shownIds} copy={copy} />
              </div>
            ) : null}
            <ol aria-label={`${head.title} alerts`}>
              {alerts.map((a, i) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  index={i + 1}
                  when={relativeTime(a.createdAt, now)}
                  ackWhen={a.acknowledgedAt ? relativeTime(a.acknowledgedAt, now) : undefined}
                />
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="push">
        <SectionHead index="02" title="Push" serif="notifications" meta="Count and kind only, never the text" id="push" />
        <EnablePush vapidPublicKey={isVapidPublicKey(vapid) ? vapid : null} activeCount={devices} />
      </section>
    </AppFrame>
  );
}
