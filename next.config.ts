import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 断网时让导航 / Server Action 自动重试，配合 OfflineBanner 提示。
    useOffline: true,
  },
};

export default nextConfig;
