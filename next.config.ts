import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_ENV:
      process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? "",
  },
  serverExternalPackages: ["canvas"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
