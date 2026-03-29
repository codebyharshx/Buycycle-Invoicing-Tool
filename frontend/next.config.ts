import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/types"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
