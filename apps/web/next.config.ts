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
  /**
   * `next dev` and the local production build used to share `.next` and wipe
   * each other's cache, so serving the build after a dev session — or after
   * this one — meant a full rebuild, measured at 150s and 352s on this tree.
   * scripts/start-local-prod.mjs points the build at its own directory, which
   * leaves both intact and makes switching a restart rather than a rebuild.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  /**
   * Next shows its route/bundler indicator whenever NODE_ENV is not production,
   * which scripts/start-local-prod.mjs deliberately arranges so the startup
   * check does not treat a local run as a deployment. The panel it opens sits
   * bottom-left, on top of the workspace sidebar's own controls — it covers the
   * navigation and the sign-out button rather than floating clear of them.
   */
  devIndicators: false,
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
    /**
     * `staleTimes: { dynamic: N }` is deliberately NOT set.
     *
     * It was tried, to spare each tab click a full RSC round trip through the
     * layout's auth and workspace queries. It cannot be had safely here: this
     * codebase navigates after a mutation with `router.push` and relies on the
     * dynamic staleTime of 0 to re-render the destination. Only 9 of 22 push
     * sites pair the call with `router.refresh()`, so a non-zero window serves
     * the pre-mutation payload at the other 13 — a deleted lead still listed,
     * a just-logged call missing from the list — and every new push site
     * inherits the trap.
     *
     * The navigation cost this was aimed at is addressed at the source instead
     * (see the layout's query reductions and the Link fixes in the top bar);
     * tests/e2e/request-budget.spec.ts holds that line.
     */
  },
};

export default config;
