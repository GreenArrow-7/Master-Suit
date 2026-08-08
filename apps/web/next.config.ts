import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Content-Security-Policy is NOT here. It carries a per-request script nonce,
  // which a static header cannot express — see src/middleware.ts.
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
  experimental: {
    /**
     * Enables `forbidden()` and `forbidden.tsx`.
     *
     * A page the viewer lacks permission for used to throw a 403 AppError, which
     * the generic error boundary rendered as "Something went wrong on our side"
     * — reporting a server fault for a working access check, and offering "Try
     * again" as the remedy. Detecting the status in the boundary is not an
     * option: React strips the message in production and leaves only a digest.
     * This is the framework's own interrupt for exactly this case.
     */
    authInterrupts: true,
  },
};

export default config;
