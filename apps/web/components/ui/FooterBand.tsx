import Link from "next/link";
import { cx, FOCUS } from "./cx.js";
import { CONTAINER } from "./GridLines.js";
import { Icon } from "./Icon.js";
import { Marquee } from "./Marquee.js";
import { StatusPulse } from "./StatusPulse.js";

export type FooterLink = { href: string; label: string; sub?: string };

/**
 * Massive black footer: "Next" + one big link with a growing underline, a 20vw background marquee,
 * and a status row (pulse + meta). Inverted colours in both themes.
 */
export function FooterBand({
  link,
  marquee = "RUNMYSOCIALS",
  status,
  meta,
}: {
  link: FooterLink;
  marquee?: string;
  status: string;
  meta: string;
}) {
  return (
    <footer className="relative overflow-hidden bg-ds-invert text-ds-on-invert">
      <div className={cx(CONTAINER, "relative z-10 pb-8 pt-16 lg:pt-24")}>
        <p className="ds-caps opacity-80">Next</p>
        <Link
          href={link.href}
          className={cx(
            "mt-4 inline-flex min-h-11 items-center gap-3 text-[36px] font-black leading-none tracking-[-0.03em] lg:text-[56px]",
            "relative after:absolute after:inset-x-0 after:-bottom-2 after:block after:h-px after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-[600ms] after:ease-ds hover:after:scale-x-100 focus-visible:after:scale-x-100",
            FOCUS,
          )}
        >
          {link.label}
          <Icon name="arrowUpRight" size={40} strokeWidth={2} className="size-[0.8em]" />
        </Link>
        {link.sub && <p className="ds-mono mt-5 opacity-80">{link.sub}</p>}
      </div>

      <Marquee size="bg" label={marquee} items={[{ text: marquee }, { text: marquee }]} className="relative mt-4" />

      <div className={CONTAINER}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-current/20 py-6">
          <StatusPulse label={status} tone="accent" />
          <p className="ds-caps opacity-80">{meta}</p>
        </div>
      </div>
    </footer>
  );
}
