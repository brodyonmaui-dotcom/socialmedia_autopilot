import { fetchCreatorSnapshot, type FetchLike } from "../discovery.js";
import type { CreatorSnapshot } from "../brief.js";
import type { Creator } from "../types.js";

/**
 * A FetchLike that answers Business Discovery requests from a fixture keyed by handle (documented
 * response bodies), so the seed and the end-to-end test run the real pipeline (discoveryUrl →
 * toSnapshot) without any network. Unknown handles get Graph's "not a business account" style error.
 */
export function createFixtureFetch(bodies: Record<string, unknown>): FetchLike {
  return async (url) => {
    const handle = decodeURIComponent(url).match(/business_discovery\.username\(([a-z0-9._]+)\)/)?.[1] ?? "";
    const body = handle && handle !== "_note" ? bodies[handle] : undefined;
    if (!body) return { status: 400, json: async () => ({ error: { code: 110, message: "not a business or creator account (fixture)" } }) };
    return { status: 200, json: async () => body };
  };
}

/** discover() for runResearchRefresh backed by a fixture. Never touches the network. */
export function fixtureDiscover(bodies: Record<string, unknown>): (c: Creator) => Promise<CreatorSnapshot> {
  const fetch = createFixtureFetch(bodies);
  return (c) => fetchCreatorSnapshot(c, { igUserId: "1", accessToken: "fixture", fetch });
}
