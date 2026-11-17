import { Card, CardLink, PlatformLogo } from "../ui/index.js";
import type { PlatformCard } from "../../lib/analytics/overview.js";
import { PLATFORM_LABEL, fmtInt, fmtRate, notCollectedCopy } from "../../lib/analytics/present.js";

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="ds-label text-ds-muted">{label}</dt>
      <dd className="ds-num text-[20px] font-bold leading-tight text-ds-text">{value ?? "–"}</dd>
    </div>
  );
}

/** One platform on the overview: its numbers for the range, or why there are none; links to its page. */
export function PlatformSummary({ card, href }: { card: PlatformCard; href: string }) {
  const name = PLATFORM_LABEL[card.platform];
  const fd = card.followersDelta;
  return (
    <Card
      title={name}
      titleId={`platform-${card.platform}`}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <PlatformLogo platform={card.platform} size={14} className="text-ds-text" />
          {card.collected ? (fd != null && fd !== 0 ? `${fd > 0 ? "+" : "−"}${fmtInt(Math.abs(fd))} followers` : "Numbers collected daily") : "Not collected"}
        </span>
      }
      action={<CardLink href={href}>{card.collected ? "Details" : "Why"}</CardLink>}
    >
      {card.collected ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Followers" value={fmtInt(card.followers)} />
          <Stat label="Views" value={fmtInt(card.views)} />
          <Stat label="Posts" value={fmtInt(card.posts)} />
          <Stat label="Engagement" value={fmtRate(card.engagementRate)} />
        </dl>
      ) : (
        <p className="text-[14px] leading-snug text-ds-muted">{notCollectedCopy(card.platform, card.reason ?? "Not collected.").headline}</p>
      )}
    </Card>
  );
}
