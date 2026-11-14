import type { ReactNode } from "react";
import { CONTAINER, Display, FooterBand, StatusPulse, TabLinks, cx, type PulseTone } from "../../../components/ui/index.js";
import { heroLines, primaryTabs, type InboxCounts } from "../../../lib/inbox/view.js";

export const inboxFooter = (
  <FooterBand link={{ href: "/alerts", label: "Alerts", sub: "Kill trips, failures and mode changes land there" }} status="Approval first · shadow by default" meta="runmysocials · engagement" />
);

/**
 * Inbox hero (7 / 5 split) + the Comments / DMs tab band. `aside` is the right-hand cell
 * (the kill switch on /inbox, the read-only note on /inbox/dms).
 */
export function InboxHero({ c, pulse, onDms, aside }: { c: InboxCounts; pulse: { label: string; tone: PulseTone }; onDms: boolean; aside: ReactNode }) {
  return (
    <>
      <section aria-label="Inbox status" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-3">
              <StatusPulse tone={pulse.tone} label={pulse.label} />
              <span className="ds-mono text-ds-faint">F3 / INBOX</span>
            </div>
            <Display lines={heroLines(c)} />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-6 border-t border-ds-line py-8 lg:col-span-5 lg:border-l lg:border-t-0 lg:py-16 lg:pl-10">
            {aside}
          </div>
        </div>
      </section>
      <div className="border-b border-ds-line">
        <div className={cx(CONTAINER, "py-6")}>
          <TabLinks ariaLabel="Inbox" items={primaryTabs(onDms, c)} />
        </div>
      </div>
    </>
  );
}
