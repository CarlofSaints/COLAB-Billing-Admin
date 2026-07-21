import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Staff spreadsheets can be larger than the 1 MB default.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
