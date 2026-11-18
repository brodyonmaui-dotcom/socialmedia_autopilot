// Fable to review
// Next.js instrumentation hook: runs once when a server process starts. Node runtime only (the import sits
// inside the NEXT_RUNTIME check, so the edge bundle never sees pg), and never during `next build`. Starts the
// "Editor approval counts" tick (lib/editor/auto-approve-timer.ts); with the setting off (the default) each
// tick is one settings read.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startEditorAutoApprove } = await import("./lib/editor/auto-approve-timer.js");
    startEditorAutoApprove();
  }
}
