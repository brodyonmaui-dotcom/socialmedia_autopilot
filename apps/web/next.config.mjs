/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Local verification only: lets a build run next to a running `next dev` (NEXT_DIST_DIR=.next-verify). Default unchanged.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  basePath: "/app",
  // F20 E: a sound upload (mp3/m4a/wav up to 15 MB) is a server action; the default 1 MB body limit would refuse it.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  transpilePackages: ["@autopilot/core", "@autopilot/adapters", "@autopilot/db", "@autopilot/research", "@autopilot/analytics", "@autopilot/engagement", "@autopilot/media"],
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
