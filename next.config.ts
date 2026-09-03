import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only allowlist so the e2b preview host can load dev-mode assets and
  // hydrate; production builds are unaffected.
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  serverExternalPackages: ["ffmpeg-static", "@ffprobe-installer/ffprobe"],
};

export default nextConfig;
