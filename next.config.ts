import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["canvas", "mupdf"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
