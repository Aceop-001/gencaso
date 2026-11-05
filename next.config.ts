import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  // GENCASO uses no next/image; keep the optimizer (and sharp) off so it can never process untrusted images
  images: { unoptimized: true },
};

export default nextConfig;
