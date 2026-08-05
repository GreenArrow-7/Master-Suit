import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isProduction
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // This repository intentionally lives inside a directory whose parent also
  // contains Node projects. Pinning the root prevents Turbopack from inferring
  // src/app (or a sibling application's lockfile) as the workspace root.
  turbopack: { root: process.cwd() },
  // BullMQ remains a runtime dependency. Externalizing it prevents Next from
  // traversing its optional Valkey-Glide adapter and emitting a false missing
  // module warning when the application uses ioredis.
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', 'pino', 'bullmq'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
