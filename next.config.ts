import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't advertise the framework/version to clients.
  poweredByHeader: false,
};

export default nextConfig;
