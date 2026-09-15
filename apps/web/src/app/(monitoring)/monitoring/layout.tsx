import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { requirePlatformSupport } from '@/lib/auth/platform';
import TopBar from '@/components/nav/TopBar';

export const dynamic = 'force-dynamic';

/**
 * The monitoring console's shell.
 *
 * A separate route group from `(platform)` rather than a section inside it, and
 * the reason is the sidebar as much as the gate. `(platform)` renders
 * `PlatformSidebar` — workspaces, plans, subscriptions, users, settings, the
 * security ledger — which is the control plane, and SUPPORT has no business in
 * any of it. Relaxing that layout's gate to admit support staff would put every
 * one of those links in front of them and leave eleven pages defended only by
 * their own `requirePlatformPage()` calls. Two shells, two gates, no overlap.
 *
 * As with `(platform)`, this layout is defence in depth and not the control:
 * a layout cannot stop the page beneath it rendering, so every page under here
 * calls `requireMonitoringPage()` as its first statement and
 * `tests/security/platform-page-guard.spec.ts` fails any that does not. See
 * `lib/monitoring-page.ts` and BUG-008.
 */
export default async function MonitoringLayout({ children }: { children: React.ReactNode }) {
  let staff;
  try {
    staff = await requirePlatformSupport(
      new Request('http://internal/monitoring', { headers: await headers() }),
      ulid(),
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/no-platform-access');
    throw error;
  }

  return (
    <div className="lf-app-frame">
      <div className="lf-content-column">
        <TopBar module="platform" workspaceName="Platform monitoring" />
        <main className="lf-page-main">
          {/* The signed-in identity, shown because monitoring is attributable by
              design: whoever is looking should be able to see whose name is on
              the audit rows they are generating. */}
          <p className="lf-muted" style={{ marginBottom: 16 }} data-testid="monitoring-session-mode">
            Signed in as {staff!.email} ·{' '}
            {staff!.credentialPurpose === 'MONITORING'
              ? 'monitoring password · read-only monitoring session'
              : `${staff!.platformRole} · administration password`}
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}
