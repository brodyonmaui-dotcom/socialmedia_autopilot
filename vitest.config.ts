import { defineConfig } from "vitest/config";

// Only change from vitest defaults: compile .tsx with the automatic JSX runtime (React 19),
// so UI components can be imported in render smoke tests. Include/exclude globs stay default.
export default defineConfig({
  esbuild: { jsx: "automatic" },
});
