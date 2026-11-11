/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  basePath: "/app",
  transpilePackages: ["@autopilot/core"],
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
