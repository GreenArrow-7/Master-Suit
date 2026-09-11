import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { requirePlatformSupport } from '@/lib/auth/platform';
import type { PlatformCtx } from '@/lib/auth/session';

/**
 * The gate for a monitoring console page. Call it first, before reading anything.
 *
 * The sibling of `lib/platform-page.ts`, for the same reason and with the same
 * shape — `BUG-008` is a property of the App Router, not of the control plane:
 * a layout cannot stop the page beneath it rendering, so its refusal sets the
 * status and `Location` while the page's output is serialised into the flight
 * payload of that same response. `GET /platform` answered `307` with ~31 KB of
 * console in the body. A monitoring console is another set of pages under
 * another layout, and it would answer the same way.
 *
 * Two guards rather than one shared `requirePage(gate)` helper, because the
 * thing that makes the platform one enforceable is that
 * `tests/security/platform-page-guard.spec.ts` can assert an exact first
 * statement in every page under a root. A parameterised guard would make that
 * assertion "some call to requirePage with some argument", which is a weaker
 * property and the argument is exactly what would be got wrong.
 *
 * ── What it does not decide ─────────────────────────────────────────────────
 *
 * Only whether the caller is platform staff at all. *Which* workspaces they may
 * open is `mayEnterWorkspace`, checked by the `enter` route and again by
 * `resolveCtx` on every subsequent request; what they may do once inside is
 * `buildSupportActor`. This gate is the front door, not the whole building.
 */
export async function requireMonitoringPage(): Promise<PlatformCtx> {
  try {
    return await requirePlatformSupport(
      new Request('http://internal/monitoring', { headers: await headers() }),
      ulid(),
    );
  } catch (error) {
    // 401: no session, or an expired one. Signing in is the answer.
    if (error instanceof AppError && error.status === 401) redirect('/login');
    // 403: signed in, and this is not their area. Say which, rather than "sign in".
    if (error instanceof AppError && error.status === 403) redirect('/no-platform-access');
    // Anything else is a genuine fault and must not be dressed as either.
    throw error;
  }
}
