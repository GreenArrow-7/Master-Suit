import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import { POSSESSION_STATUSES, PROJECT_STATUSES } from '@/lib/inventory/catalogue';

export const metadata = { title: 'New project' };

/**
 * Creating a project asks for what identifies and places it, and nothing else.
 *
 * The price band, the area band and the unit-type list are absent on purpose:
 * they are derived from the unit plans added afterwards, and a hand-typed band
 * that disagrees with the plans beneath it makes the catalogue filter return
 * the wrong projects. Everything else is editable from the detail page or the
 * API once the record exists.
 */
export default async function NewProjectPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['projects', 'CREATE'] });

  const [micromarkets, developers, amenities] = await Promise.all([
    prisma.micromarket.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: 300,
    }),
    prisma.developer.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 300,
    }),
    prisma.amenity.findMany({
      where: { tenantId: ctx.tenantId },
      select: { key: true, label: true },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
      take: 200,
    }),
  ]);

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          New project
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Add the unit plans next — the price band and availability on the catalogue come from them.
        </p>
      </header>

      <WorkspaceRecordForm
        endpoint="/api/v1/projects"
        submitLabel="Create project"
        fields={[
          { name: 'name', label: 'Project name', required: true },
          { name: 'code', label: 'Code', required: true, placeholder: 'Used by brochures and imports' },
          {
            name: 'micromarketId',
            label: 'Micromarket',
            type: 'select',
            options: micromarkets.map((m) => ({ value: m.id, label: `${m.name}, ${m.city}` })),
          },
          {
            name: 'developerId',
            label: 'Developer',
            type: 'select',
            options: developers.map((d) => ({ value: d.id, label: d.name })),
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: PROJECT_STATUSES.map((s) => ({ value: s, label: title(s) })),
          },
          {
            name: 'possessionStatus',
            label: 'Possession',
            type: 'select',
            options: POSSESSION_STATUSES.map((p) => ({ value: p, label: title(p) })),
          },
          { name: 'possessionAt', label: 'Possession date', type: 'date' },
          { name: 'address', label: 'Address' },
          { name: 'latitude', label: 'Latitude', type: 'number' },
          { name: 'longitude', label: 'Longitude', type: 'number' },
          { name: 'reraNumber', label: 'RERA number' },
          { name: 'reraAuthority', label: 'RERA authority' },
          { name: 'reraExpiresAt', label: 'RERA expires', type: 'date' },
          {
            name: 'amenityKeys',
            label: 'Amenities',
            type: 'multiselect',
            options: amenities.map((a) => ({ value: a.key, label: a.label })),
          },
        ]}
      />
    </>
  );
}

const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
