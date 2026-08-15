import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';

export const metadata = { title: 'Settings' };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatWorkingHours(wh: unknown): string {
  if (!wh || typeof wh !== 'object') return '—';
  const obj = wh as Record<string, unknown>;
  const entries = Object.entries(obj).filter(([, v]) => v);
  if (entries.length === 0) return '—';
  return entries
    .map(([day, val]) => {
      if (typeof val === 'object' && val && 'start' in val && 'end' in val) {
        return `${day}: ${(val as any).start}–${(val as any).end}`;
      }
      return `${day}: ${String(val)}`;
    })
    .join(', ');
}

export default async function SettingsPage() {
  const ctx = await requirePageAccess({ permission: ['settings', 'VIEW'] });
  if (!can(ctx, 'settings', 'VIEW')) redirect('/home');

  const settings = await prisma.organizationSetting.findUnique({
    where: { tenantId: ctx.tenantId },
  });

  // One page, three named groups — workspace identity, security posture,
  // working time — instead of one undifferentiated list. The Administration
  // group in the sidebar is already the settings navigation; a second in-page
  // nav would duplicate it.
  const groups: [string, [string, string][]][] = settings
    ? [
        [
          'Workspace',
          [
            ['Product name', settings.productName],
            ['Default timezone', settings.defaultTimezone],
            ['Default currency', settings.defaultCurrency],
            ['Default locale', settings.defaultLocale],
            ['Fiscal year start', MONTHS[settings.fiscalYearStart - 1] ?? String(settings.fiscalYearStart)],
          ],
        ],
        [
          'Security',
          [
            ['MFA required', settings.mfaRequired ? 'Yes' : 'No'],
            ['Session lifetime', `${settings.sessionTtlMinutes} minutes`],
          ],
        ],
        ['Working hours', [['Standard week', formatWorkingHours(settings.workingHours)]]],
      ]
    : [];

  return (
    <div className="lf-page-stack">
      <header>
        <div className="lf-eyebrow">Administration</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 6 }}>
          Settings
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Workspace-wide configuration. Users, roles, security policy and integrations each have their own page under
          Administration.
        </p>
      </header>

      {!settings ? (
        <div className="lf-card" style={{ padding: 'var(--lf-space-5)', color: 'var(--lf-ink-3)' }}>
          No settings configured for this organization.
        </div>
      ) : (
        groups.map(([title, fields]) => (
          <section className="lf-card" key={title} style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
              {title}
            </div>
            <dl className="lf-facts" style={{ margin: 0 }}>
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt className="lf-label">{label}</dt>
                  <dd style={{ margin: '3px 0 0', fontSize: 'var(--lf-text-sm)', overflowWrap: 'anywhere' }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </div>
  );
}
