import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ["papaparse"],
  async rewrites() {
    // Proxy /api/* to the backend in development to avoid cross-origin SSE/CORS issues.
    // API_INTERNAL_URL must be set to the backend URL reachable from this server:
    //   - local dev (outside Docker): http://localhost:8000
    //   - Docker dev:                 http://api:8000
    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
