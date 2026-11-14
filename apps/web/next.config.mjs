/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Local verification only: lets a build run next to a running `next dev` (NEXT_DIST_DIR=.next-verify). Default unchanged.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  basePath: "/app",
  transpilePackages: ["@autopilot/core", "@autopilot/adapters", "@autopilot/db", "@autopilot/research", "@autopilot/analytics", "@autopilot/engagement"],
  // @autopilot/core ships TS source with NodeNext-style ".js" import specifiers (for tsc/tsx);
  // webpack needs to know those resolve to .ts files too.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
