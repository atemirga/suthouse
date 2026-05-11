/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Скрываем заголовок X-Powered-By: Next.js — не раскрываем стек атакующему.
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
  // Базовые security-headers, дополняющие nginx-конфигурацию.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },              // clickjacking
          { key: 'X-Content-Type-Options', value: 'nosniff' },          // MIME-sniffing
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
