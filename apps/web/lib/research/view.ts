/** Small pure helpers shared by the /research pages. The card view logic lives in ./cards.ts. */

export const creatorPlatform = (p: string): "instagram" | "youtube" | "tiktok" | "snapchat" =>
  p === "youtube" || p === "tiktok" || p === "snapchat" ? p : "instagram";
