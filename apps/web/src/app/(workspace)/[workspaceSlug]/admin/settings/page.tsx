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

  const fields: [string, string][] = settings
    ? [
        ['Product Name', settings.productName],
        ['Default Timezone', settings.defaultTimezone],
        ['Default Currency', settings.defaultCurrency],
        ['Default Locale', settings.defaultLocale],
        ['Fiscal Year Start', MONTHS[settings.fiscalYearStart - 1] ?? String(settings.fiscalYearStart)],
        ['MFA Required', settings.mfaRequired ? 'Yes' : 'No'],
        ['Session TTL', `${settings.sessionTtlMinutes} minutes`],
        ['Working Hours', formatWorkingHours(settings.workingHours)],
      ]
    : [];

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          Settings
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Organization configuration
        </p>
      </header>

      <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        {!settings ? (
          <p style={{ color: 'var(--lf-ink-3)' }}>No settings configured for this organization.</p>
        ) : (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: 'var(--lf-space-3) var(--lf-space-5)',
              margin: 0,
            }}
          >
            {fields.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt style={{ fontWeight: 500, color: 'var(--lf-ink-2)', whiteSpace: 'nowrap' }}>{label}</dt>
                <dd style={{ margin: 0, color: 'var(--lf-ink)' }}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  );
}
