/** @type {import('next').NextConfig} */
const publicApiBase = process.env.NEXT_PUBLIC_API_BASE || "/api";
const backendInternalBase = (process.env.BACKEND_INTERNAL_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (/^https?:\/\//i.test(publicApiBase)) {
      return [];
    }
    const normalizedPublicBase = publicApiBase.startsWith("/") ? publicApiBase : `/${publicApiBase}`;
    return [
      {
        source: `${normalizedPublicBase}/:path*`,
        destination: `${backendInternalBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
