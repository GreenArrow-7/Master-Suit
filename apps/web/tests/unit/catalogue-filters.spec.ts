import { describe, expect, it } from 'vitest';
import { catalogueFilters, catalogueWhere, PROJECT_STATUSES } from '@/lib/inventory/catalogue';

describe('catalogueWhere', () => {
  it('ignores status and possession values outside the enums instead of passing them to the database', () => {
    const filters = catalogueFilters.parse({
      status: `ACTIVE,${PROJECT_STATUSES[0]}`,
      possession: 'SOON,READY_TO_MOVE',
    });
    const where = catalogueWhere('tenant', filters) as {
      status?: { in: string[] };
      possessionStatus?: { in: string[] };
    };
    expect(where.status).toEqual({ in: [PROJECT_STATUSES[0]] });
    expect(where.possessionStatus).toEqual({ in: ['READY_TO_MOVE'] });
  });

  it('sets no status filter when every value is unknown', () => {
    const where = catalogueWhere('tenant', catalogueFilters.parse({ status: 'ACTIVE' })) as { status?: unknown };
    expect(where.status).toBeUndefined();
  });
});
