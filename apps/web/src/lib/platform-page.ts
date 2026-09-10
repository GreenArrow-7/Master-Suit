import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import type { PlatformCtx } from '@/lib/auth/session';

/**
 * The gate for a platform console page. Call it first, before reading anything.
 *
 * ── Why a page-level gate exists at all ─────────────────────────────────────
 *
 * `(platform)/platform/layout.tsx` guards the console, and for a long time it
 * was the only thing that did — ten of the eleven pages under it asserted
 * nothing, and the eleventh only mentioned this function in a comment.
 *
 * A layout cannot stop the page beneath it from rendering. Next invokes both,
 * and the layout's refusal decides the status and the `Location` header while
 * the page's output is still serialised into the flight payload of that same
 * response. `GET /platform` therefore answered `307` **with a body** — every
 * workspace name, the platform owner's address, platform-wide user and
 * employee counts, and the platform security ledger — to a caller with no
 * session at all. A browser follows the redirect and shows none of it. `curl`
 * reads it. `BUG-008` / `SEC-OBS-014`.
 *
 * `forbidden()` was measured and behaves the same way, so this is not a choice
 * of interrupt. The only thing that stops the payload existing is not building
 * it, which means the check has to sit above the queries — here.
 *
 * ── What it does not change ─────────────────────────────────────────────────
 *
 * Nothing about who may enter. `requirePlatformOwner` is still the whole of the
 * decision, and the layout keeps its own call so the navigation shell is never
 * rendered for someone who cannot use it. This is defence in depth in the
 * literal sense: two independent gates, the same rule.
 */
export async function requirePlatformPage(): Promise<PlatformCtx> {
  try {
    return await requirePlatformOwner(new Request('http://internal/platform', { headers: await headers() }), ulid());
  } catch (error) {
    // 401: no session, or an expired one. Signing in is the answer.
    if (error instanceof AppError && error.status === 401) redirect('/login');
    // 403: signed in, and this is not their area. Say which, rather than "sign in".
    if (error instanceof AppError && error.status === 403) redirect('/no-platform-access');
    // Anything else is a genuine fault and must not be dressed as either.
    throw error;
  }
}
