import type { SVGProps } from "react";

export type Platform = "instagram" | "youtube" | "tiktok" | "snapchat";

export const PLATFORM_NAME: Record<Platform, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  snapchat: "Snapchat",
};

/**
 * Platform glyphs in one colour (currentColor), never brand colours, so the accent stays the only colour.
 * Simplified marks on a 24-unit grid; they read at 18–28 px. Decorative unless `title` is given.
 */
export function PlatformLogo({
  platform,
  size = 24,
  title,
  ...rest
}: { platform: Platform; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "children">) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
  const common = { width: size, height: size, viewBox: "0 0 24 24", focusable: "false" as const, ...a11y, ...rest };
  switch (platform) {
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.9}>
          <rect x="3" y="3" width="18" height="18" rx="5.2" />
          <circle cx="12" cy="12" r="4.1" />
          <circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path
            fillRule="evenodd"
            d="M6.2 4.8h11.6A4.2 4.2 0 0 1 22 9v6a4.2 4.2 0 0 1-4.2 4.2H6.2A4.2 4.2 0 0 1 2 15V9a4.2 4.2 0 0 1 4.2-4.2zM10 8.6v6.8l5.8-3.4z"
          />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common} fill="currentColor">
          <path d="M16.6 3h-3.1v11.7a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V8.7a6.1 6.1 0 1 0 5.1 6V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-4.3-4.4z" />
        </svg>
      );
    case "snapchat":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
          <path d="M12 3c-3 0-5 2.2-5 5v2.2l-1.6.5c-.5.2-.5.8 0 1l1.5.6c-.6 1.6-1.8 2.9-3.4 3.5.4.7 1.5 1 2.6 1.2l.4 1.2 1.5-.2c.9.6 2 1.5 4 1.5s3.1-.9 4-1.5l1.5.2.4-1.2c1.1-.2 2.2-.5 2.6-1.2-1.6-.6-2.8-1.9-3.4-3.5l1.5-.6c.5-.2.5-.8 0-1L17 10.2V8c0-2.8-2-5-5-5z" />
        </svg>
      );
  }
}
