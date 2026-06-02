import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't bundle these Node.js-native packages — require them at runtime instead
  serverExternalPackages: ["msedge-tts", "ws", "@libsql/client"],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
        buffer: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
