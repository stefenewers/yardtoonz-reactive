import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ffmpeg-static", "@ffprobe-installer/ffprobe"],
};

export default nextConfig;
