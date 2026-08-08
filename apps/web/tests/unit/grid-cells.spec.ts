/**
 * Every configurable column must have a renderer. `renderCell` ends in a
 * `default: return dash` arm, so a column added to the catalogue without a matching
 * case fails silently — the grid renders an em dash in every row and looks like
 * missing data rather than missing code. These assertions catch that at build time.
 */
import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, GRID_OBJECTS, type GridObject } from '@/lib/grid/columns';
import { renderCell } from '@/components/workspace/gridCells';

/** A row carrying a plausible value for every field any renderer reads. */
const row = {
  id: 'c000000000000000000000001',
  reference: 'LD-000001',
  number: 'TK-000001',
  code: 'SKU-1',
  fullName: 'Sara Haddad',
  name: 'Northbay Logistics',
  title: 'Call back',
  subject: 'Cannot log in',
  company: 'Northbay',
  industry: 'Logistics',
  jobTitle: 'Head of Ops',
  email: 'sara@example.com',
  phone: '+971500000000',
  mainEmail: 'ops@example.com',
  mainPhone: '+971500000001',
  recipientNumber: '+971500000002',
  toAddress: 'sara@example.com',
  score: 72,
  grade: 'A',
  priority: 'HIGH',
  slaState: 'ON_TRACK',
  status: 'ACTIVE',
  customerTier: 'GOLD',
  category: 'Services',
  mimeType: 'application/pdf',
  sizeBytes: 204_800,
  unitPrice: 1500,
  amount: 25_000,
  currency: 'AED',
  probability: 60,
  channel: 'WHATSAPP',
  direction: 'OUTBOUND',
  outcome: 'CONNECTED',
  campaignType: 'Launch',
  budget: 5000,
  notes: 'Spoke to the operations lead.',
  durationSecs: 195,
  distanceMeters: 420,
  geofenceOk: true,
  rep: 'Omar Ahmadi',
  // Inventory catalogue (PROJECT).
  minPrice: 1_200_000,
  maxPrice: 3_400_000,
  pricePerSqft: 1_650,
  unitTypes: ['1BHK', '2BHK'],
  totalUnits: 240,
  availableUnits: 61,
  soldUnits: 40,
  isPriority: true,
  isPitchable: true,
  micromarket: { id: 'c000000000000000000000004', name: 'Marina', city: 'Dubai' },
  developer: { id: 'c000000000000000000000005', name: 'Falcon Developments' },
  // Listing book (LISTING).
  listingType: 'SALE',
  bedrooms: 2,
  bathrooms: 2,
  propertyType: 'APARTMENT',
  price: 1_850_000,
  rentFrequency: null,
  mandateType: 'EXCLUSIVE',
  mandateExpires: new Date('2026-11-30T00:00:00Z'),
  areaSqft: 1_240,
  propertyOwner: { id: 'c000000000000000000000006', fullName: 'Yusuf Rahman' },
  stage: { key: 'qualified', name: 'Qualified', color: '#000' },
  type: { key: 'call', name: 'Call' },
  lead: { id: 'c000000000000000000000002', fullName: 'Priya Karim' },
  account: { id: 'c000000000000000000000003', name: 'Falcon Ridge' },
  owner: { fullName: 'Clara Lindqvist' },
  agent: { fullName: 'Rohan Mehta' },
  occurredAt: new Date('2026-08-01T09:00:00Z'),
  createdAt: new Date('2026-08-01T09:00:00Z'),
  updatedAt: new Date('2026-08-02T09:00:00Z'),
  dueAt: new Date('2026-08-10T09:00:00Z'),
  completedAt: new Date('2026-08-03T09:00:00Z'),
  startedAt: new Date('2026-08-01T09:05:00Z'),
  startDate: new Date('2026-08-01T00:00:00Z'),
  endDate: new Date('2026-08-31T00:00:00Z'),
  expectedCloseDate: new Date('2026-09-15T00:00:00Z'),
  nextFollowUpAt: new Date('2026-08-09T09:00:00Z'),
  plannedAt: new Date('2026-08-05T09:00:00Z'),
  checkInAt: new Date('2026-08-05T09:10:00Z'),
};

/** The sentinel the default arm returns; identical by reference every time. */
const unhandled = (object: GridObject) => renderCell(object, '__no_such_column__', row);

describe('renderCell', () => {
  // LEAD is drawn by LeadGrid's own cell map, not this one.
  const objects = GRID_OBJECTS.filter((object) => object !== 'LEAD');

  it.each(objects)('%s has a renderer for every catalogue column', (object) => {
    const missing = GRID_COLUMNS[object]
      .filter((column) => renderCell(object, column.key, row) === unhandled(object))
      .map((column) => column.key);
    expect(missing, `${object} columns fall through to the default arm`).toEqual([]);
  });

  it.each(objects)('%s survives a row with nothing populated', (object) => {
    // Relations are null before they load and optional fields are frequently unset;
    // a renderer that reaches into one unguarded takes the whole page down.
    for (const column of GRID_COLUMNS[object]) {
      expect(() => renderCell(object, column.key, { id: 'x' })).not.toThrow();
    }
  });
});
