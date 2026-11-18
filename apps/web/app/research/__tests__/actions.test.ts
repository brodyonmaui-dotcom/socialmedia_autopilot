import { beforeEach, describe, expect, it, vi } from "vitest";

// Research add forms: a validation error goes back with the typed text (draft_…) and the dialog open;
// a success goes back with a note and echoes nothing.
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000001", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const db = vi.hoisted(() => ({ getPool: vi.fn(() => ({ query: vi.fn() })) }));
const nav = vi.hoisted(() => ({ redirect: vi.fn(), revalidatePath: vi.fn() }));
const research = vi.hoisted(() => ({ addIdea: vi.fn(), addHook: vi.fn(), addCreator: vi.fn() }));

vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => db);
vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: nav.revalidatePath }));
vi.mock("@autopilot/research", async (importOriginal) => ({ ...(await importOriginal<object>()), ...research, blocklistFromEnv: () => [] }));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

const flow = await import("../flow-actions.js");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const invalid = (message: string) => Object.assign(new Error(message), { name: "ValidationError" });
const redirectOf = async (p: Promise<void>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Redirect);
  const url = (err as Redirect).url;
  const [path, query = ""] = url.split("?", 2);
  return { url, path, q: new URLSearchParams(query) };
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireSession.mockResolvedValue(SESSION);
  nav.redirect.mockImplementation((url: string) => {
    throw new Redirect(url);
  });
});

describe("research add forms keep the typed text on a validation error", () => {
  it("add idea: error redirect reopens the dialog on the return page with the fields", async () => {
    research.addIdea.mockRejectedValue(invalid("The idea needs a title."));
    const fd = form({ title: "pull day, slow negatives", hook: "My lats are not a fan", pillar: "gym", return: "/research?pillar=gym", script: "not this form" });
    const { path, q } = await redirectOf(flow.addIdeaFlowAction(fd));
    expect(path).toBe("/research");
    expect(q.get("pillar")).toBe("gym");
    expect(q.get("error")).toBe("The idea needs a title.");
    expect(q.get("add")).toBe("1");
    expect(q.get("draft_title")).toBe("pull day, slow negatives");
    expect(q.get("draft_hook")).toBe("My lats are not a fan");
    expect(q.get("draft_pillar")).toBe("gym");
    expect([...q.keys()].filter((k) => k.startsWith("draft_")).sort()).toEqual(["draft_hook", "draft_pillar", "draft_title"]);
  });

  it("add idea: an unsafe return falls back to /research and long text is capped", async () => {
    research.addIdea.mockRejectedValue(invalid("Too long."));
    const { path, q } = await redirectOf(flow.addIdeaFlowAction(form({ title: "y".repeat(3000), return: "https://evil.example/" })));
    expect(path).toBe("/research");
    expect(q.get("draft_title")).toHaveLength(500);
  });

  it("add idea: success echoes nothing", async () => {
    research.addIdea.mockResolvedValue({ id: "i1" });
    const { url, q } = await redirectOf(flow.addIdeaFlowAction(form({ title: "pull day", hook: "line", return: "/research?pillar=gym" })));
    expect(url).toBe("/research?pillar=gym&note=Idea%20added.");
    expect([...q.keys()].some((k) => k.startsWith("draft_") || k === "error")).toBe(false);
  });

  it("add hook: error carries draft_text, pillar and source; success does not", async () => {
    research.addHook.mockRejectedValue(invalid("Blocked word."));
    const fd = form({ text: "My lats are not a fan of this", pillar: "gym", source: "creator", return: "/research/hooks" });
    const { path, q } = await redirectOf(flow.addHookFlowAction(fd));
    expect(path).toBe("/research/hooks");
    expect(q.get("add")).toBe("1");
    expect(q.get("draft_text")).toBe("My lats are not a fan of this");
    expect(q.get("draft_source")).toBe("creator");

    research.addHook.mockResolvedValue({ id: "h1" });
    const ok = await redirectOf(flow.addHookFlowAction(fd));
    expect(ok.url).toBe("/research/hooks?note=Hook%20added.");
  });

  it("add creator: error keeps the handle; other errors stay generic", async () => {
    research.addCreator.mockRejectedValue(invalid("That handle is blocked."));
    const { path, q } = await redirectOf(flow.addCreatorFlowAction(form({ handle: "@gym_fan_22", platform: "tiktok", pillar: "" })));
    expect(path).toBe("/research/creators");
    expect(q.get("draft_handle")).toBe("@gym_fan_22");
    expect(q.get("draft_platform")).toBe("tiktok");
    expect(q.has("draft_pillar")).toBe(false);

    research.addCreator.mockRejectedValue(new Error("duplicate key value violates constraint"));
    const generic = await redirectOf(flow.addCreatorFlowAction(form({ handle: "gym_fan_22" })));
    expect(generic.q.get("error")).toBe("something went wrong");
  });
});
