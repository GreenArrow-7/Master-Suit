import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import { FURNISHINGS, LISTING_TYPES, PROPERTY_TYPES, RENT_FREQUENCIES } from '@/lib/inventory/listings';

export const metadata = { title: 'New listing' };

/**
 * A listing needs an owner before it can exist, so this page refuses to render
 * a form when there are none — an empty owner dropdown produces a submission
 * that fails validation and tells the agent nothing about why.
 *
 * `status` is absent: a new listing is a DRAFT until a mandate says otherwise.
 */
export default async function NewListingPage() {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['listings', 'CREATE'] });

  const [owners, micromarkets, amenities] = await Promise.all([
    prisma.owner.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 300,
    }),
    prisma.micromarket.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: 300,
    }),
    prisma.amenity.findMany({
      where: { tenantId: ctx.tenantId },
      select: { key: true, label: true },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
      take: 200,
    }),
  ]);

  // No owner yet: record one here (Lead-Eagle-only workspaces have no Owners
  // screen). The form refreshes the page, which then offers the listing form.
  if (owners.length === 0) {
    return (
      <>
        <header style={{ marginBottom: 'var(--lf-space-4)' }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            Record the property owner first
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            Every listing belongs to a landlord or vendor, and the mandate is signed with them.
          </p>
        </header>
        <WorkspaceRecordForm
          endpoint="/api/v1/owners"
          submitLabel="Add owner"
          fields={[
            { name: 'fullName', label: 'Owner name', required: true },
            { name: 'phone', label: 'Phone' },
            { name: 'email', label: 'Email', type: 'email' },
          ]}
        />
      </>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          New listing
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          It starts as a draft. Record the mandate next — a listing cannot be published without one.
        </p>
      </header>

      <WorkspaceRecordForm
        endpoint="/api/v1/listings"
        submitLabel="Create listing"
        fields={[
          { name: 'title', label: 'Listing title', required: true },
          {
            name: 'listingType',
            label: 'For sale or rent',
            type: 'select',
            required: true,
            options: LISTING_TYPES.map((t) => ({ value: t, label: title(t) })),
          },
          {
            name: 'propertyOwnerId',
            label: 'Property owner',
            type: 'select',
            required: true,
            options: owners.map((o) => ({ value: o.id, label: o.fullName })),
          },
          {
            name: 'propertyType',
            label: 'Property type',
            type: 'select',
            options: PROPERTY_TYPES.map((t) => ({ value: t, label: title(t) })),
          },
          { name: 'price', label: 'Price or rent', type: 'number', required: true },
          {
            name: 'rentFrequency',
            label: 'Rent frequency',
            type: 'select',
            options: RENT_FREQUENCIES.map((f) => ({ value: f, label: title(f) })),
          },
          {
            name: 'micromarketId',
            label: 'Micromarket',
            type: 'select',
            options: micromarkets.map((m) => ({ value: m.id, label: `${m.name}, ${m.city}` })),
          },
          { name: 'community', label: 'Or a new community', placeholder: 'Dubai Marina' },
          { name: 'city', label: 'City of the new community', placeholder: 'Dubai' },
          { name: 'address', label: 'Address' },
          { name: 'bedrooms', label: 'Bedrooms', type: 'number' },
          { name: 'bathrooms', label: 'Bathrooms', type: 'number' },
          { name: 'areaSqft', label: 'Area (sqft)', type: 'number' },
          { name: 'parkingSpaces', label: 'Parking spaces', type: 'number' },
          {
            name: 'furnishing',
            label: 'Furnishing',
            type: 'select',
            options: FURNISHINGS.map((f) => ({ value: f, label: title(f) })),
          },
          { name: 'availableFrom', label: 'Available from', type: 'date' },
          { name: 'permitNumber', label: 'Trakheesi permit number' },
          { name: 'permitExpiry', label: 'Permit expires', type: 'date' },
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
