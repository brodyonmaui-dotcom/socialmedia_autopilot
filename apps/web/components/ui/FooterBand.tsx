export type FooterLink = { href: string; label: string; sub?: string };

/**
 * @deprecated v2 black footer band. v3 has no footer band (ui-system.md "Shell"), so this renders
 * nothing; it stays exported only until the remaining v2 pages drop their import.
 */
export function FooterBand(_: { link: FooterLink; marquee?: string; status: string; meta: string }) {
  return null;
}
