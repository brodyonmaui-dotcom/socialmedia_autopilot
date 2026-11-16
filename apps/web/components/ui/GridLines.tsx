/**
 * @deprecated v2 content container. In v3 the AppShell's <main> already provides the centred 1280 px
 * column and the page gutter, so this is just a full-width block (kept so older pages don't double the gutter).
 */
export const CONTAINER = "w-full min-w-0";

/**
 * @deprecated v2 decorative column lines. v3 hard rule 3 forbids background grids, so this renders
 * nothing; it stays exported only until the remaining v2 pages drop their import (then delete the file).
 */
export function GridLines() {
  return null;
}
