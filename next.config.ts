import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't bundle these Node.js-native packages — require them at runtime instead
  serverExternalPackages: ["@libsql/client"],

  // Turbopack config (default bundler in Next.js 16)
  // resolveAlias maps node built-ins to false in browser bundles so epubjs doesn't crash
  turbopack: {
    resolveAlias: {
      fs: { browser: "@/lib/empty-module" },
      path: { browser: "@/lib/empty-module" },
      stream: { browser: "@/lib/empty-module" },
      buffer: { browser: "@/lib/empty-module" },
      crypto: { browser: "@/lib/empty-module" },
    },
  },

  // Keep webpack config so `next dev --webpack` still works locally
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

  async headers() {
    return [
      {
        // COOP/COEP headers required for SharedArrayBuffer (WASM threads used by Kokoro)
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
