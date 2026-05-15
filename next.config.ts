import type { NextConfig } from "next";

const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  process.env.CONVEX_SITE_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");

const authHost = "auth.glass.insure";
const authRedirectSourceHosts = [
  "app.glass.insure",
  "broker.glass.insure",
  "glass.claritylabs.inc",
];
const authPathSources = [
  "/login",
  "/login/:path*",
  "/signup",
  "/signup/:path*",
  "/invite",
  "/invite/:path*",
  "/connect/request",
  "/connect/request/:path*",
  "/connected-orgs/request",
  "/connected-orgs/request/:path*",
  "/oauth/authorize",
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_ENV:
      process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? "",
  },
  async redirects() {
    return authRedirectSourceHosts.flatMap((host) =>
      authPathSources.map((source) => ({
        source,
        has: [{ type: "host" as const, value: host }],
        destination: `https://${authHost}${source}`,
        permanent: false,
      })),
    );
  },
  async rewrites() {
    if (!convexSiteUrl) return [];

    return [
      {
        source: "/.well-known/mcp.json",
        destination: `${convexSiteUrl}/.well-known/mcp.json`,
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: `${convexSiteUrl}/.well-known/oauth-protected-resource`,
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${convexSiteUrl}/.well-known/oauth-authorization-server`,
      },
      {
        source: "/oauth/register",
        destination: `${convexSiteUrl}/oauth/register`,
      },
      {
        source: "/oauth/token",
        destination: `${convexSiteUrl}/oauth/token`,
      },
      {
        source: "/oauth/revoke",
        destination: `${convexSiteUrl}/oauth/revoke`,
      },
      {
        source: "/mcp",
        destination: `${convexSiteUrl}/mcp`,
      },
      {
        source: "/mcp/:path*",
        destination: `${convexSiteUrl}/mcp/:path*`,
      },
    ];
  },
  serverExternalPackages: ["canvas"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
