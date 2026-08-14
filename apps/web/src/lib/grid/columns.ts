/**
 * The column catalogue for configurable list grids.
 *
 * An administrator picks which of these appear and in what order; the choice is
 * stored per workspace in `OrganizationSetting.gridColumns` as an ordered array of
 * keys, one array per object. Only the choice is stored, never the labels or the
 * rendering, so a column added or renamed in a release reaches every workspace that
 * has not overridden that object.
 *
 * `fixed` marks the columns that carry the link through to the record. They are
 * never hidden or reordered, because a row without one is a dead end.
 */

export const GRID_OBJECTS = [
  'LEAD',
  'ACCOUNT',
  'CONTACT',
  'OPPORTUNITY',
  'ACTIVITY',
  'TASK',
  'CALL',
  'CAMPAIGN',
  'COMMUNICATION',
  'PRODUCT',
  'TICKET',
  'DOCUMENT',
  'FOLLOWUP',
  'FIELDVISIT',
  'PROJECT',
  'LISTING',
] as const;

export type GridObject = (typeof GRID_OBJECTS)[number];

export interface ColumnDef {
  key: string;
  label: string;
  /** Never hidden or reordered — without it a row has no way back to its record. */
  fixed?: boolean;
  /** Shown when a workspace has expressed no preference. */
  byDefault?: boolean;
  /** Dropped from the mobile card layout, matching `data-hide-mobile`. */
  hideMobile?: boolean;
  align?: 'left' | 'right';
}

export const GRID_COLUMNS: Record<GridObject, ColumnDef[]> = {
  LEAD: [
    { key: 'reference', label: 'Reference', fixed: true },
    { key: 'fullName', label: 'Name', fixed: true },
    { key: 'company', label: 'Company', byDefault: true, hideMobile: true },
    { key: 'stage', label: 'Stage', byDefault: true },
    { key: 'score', label: 'Score', byDefault: true, align: 'right' },
    { key: 'priority', label: 'Priority', byDefault: true, hideMobile: true },
    { key: 'slaState', label: 'SLA', byDefault: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'nextFollowUpAt', label: 'Follow-up', byDefault: true, hideMobile: true },
    { key: 'email', label: 'Email', hideMobile: true },
    { key: 'phone', label: 'Phone', hideMobile: true },
    { key: 'grade', label: 'Grade', hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
  ACCOUNT: [
    { key: 'reference', label: 'Reference', fixed: true },
    { key: 'name', label: 'Name', fixed: true },
    { key: 'industry', label: 'Industry', byDefault: true, hideMobile: true },
    { key: 'mainPhone', label: 'Phone', byDefault: true, hideMobile: true },
    { key: 'mainEmail', label: 'Email', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'customerTier', label: 'Tier', hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
  CONTACT: [
    { key: 'reference', label: 'Reference', fixed: true },
    { key: 'fullName', label: 'Name', fixed: true },
    { key: 'jobTitle', label: 'Title', byDefault: true, hideMobile: true },
    { key: 'account', label: 'Account', byDefault: true, hideMobile: true },
    { key: 'email', label: 'Email', byDefault: true, hideMobile: true },
    { key: 'phone', label: 'Phone', byDefault: true, hideMobile: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
  OPPORTUNITY: [
    { key: 'reference', label: 'Reference', fixed: true },
    { key: 'name', label: 'Name', fixed: true },
    { key: 'account', label: 'Account', byDefault: true, hideMobile: true },
    { key: 'stage', label: 'Stage', byDefault: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'amount', label: 'Amount', byDefault: true, align: 'right' },
    { key: 'probability', label: 'Prob.', byDefault: true, align: 'right', hideMobile: true },
    { key: 'expectedCloseDate', label: 'Close date', byDefault: true, hideMobile: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
  ACTIVITY: [
    { key: 'occurredAt', label: 'Date', fixed: true },
    { key: 'type', label: 'Type', byDefault: true },
    { key: 'lead', label: 'Lead', byDefault: true },
    { key: 'outcome', label: 'Outcome', byDefault: true, hideMobile: true },
    { key: 'durationSecs', label: 'Duration', byDefault: true, align: 'right', hideMobile: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
  ],
  TASK: [
    { key: 'title', label: 'Title', fixed: true },
    { key: 'type', label: 'Type', byDefault: true, hideMobile: true },
    { key: 'lead', label: 'Lead', byDefault: true },
    { key: 'dueAt', label: 'Due date', byDefault: true },
    { key: 'priority', label: 'Priority', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'owner', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'completedAt', label: 'Completed', hideMobile: true },
  ],
  CALL: [
    { key: 'createdAt', label: 'Date', fixed: true },
    { key: 'lead', label: 'Lead', byDefault: true },
    { key: 'caller', label: 'Owner', byDefault: true, hideMobile: true },
    { key: 'recipientNumber', label: 'Number', byDefault: true, hideMobile: true },
    { key: 'direction', label: 'Direction', byDefault: true, hideMobile: true },
    { key: 'durationSecs', label: 'Duration', byDefault: true, align: 'right', hideMobile: true },
    { key: 'outcome', label: 'Outcome', byDefault: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'startedAt', label: 'Started', hideMobile: true },
    { key: 'notes', label: 'Notes', hideMobile: true },
  ],
  CAMPAIGN: [
    { key: 'name', label: 'Name', fixed: true },
    { key: 'campaignType', label: 'Type', byDefault: true, hideMobile: true },
    { key: 'channel', label: 'Channel', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'startDate', label: 'Start date', byDefault: true, hideMobile: true },
    { key: 'endDate', label: 'End date', byDefault: true, hideMobile: true },
    { key: 'budget', label: 'Budget', byDefault: true, align: 'right', hideMobile: true },
  ],
  COMMUNICATION: [
    { key: 'createdAt', label: 'Date', fixed: true },
    { key: 'channel', label: 'Channel', byDefault: true },
    { key: 'direction', label: 'Direction', byDefault: true, hideMobile: true },
    { key: 'toAddress', label: 'To', byDefault: true },
    { key: 'subject', label: 'Subject', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
  ],
  PRODUCT: [
    { key: 'code', label: 'Code', fixed: true },
    { key: 'name', label: 'Name', fixed: true },
    { key: 'category', label: 'Category', byDefault: true, hideMobile: true },
    { key: 'unitPrice', label: 'Unit price', byDefault: true, align: 'right' },
    { key: 'status', label: 'Status', byDefault: true },
  ],
  TICKET: [
    { key: 'number', label: 'Number', fixed: true },
    { key: 'subject', label: 'Subject', fixed: true },
    { key: 'priority', label: 'Priority', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'channel', label: 'Channel', byDefault: true, hideMobile: true },
    { key: 'slaState', label: 'SLA state', byDefault: true },
    { key: 'agent', label: 'Agent', byDefault: true, hideMobile: true },
    { key: 'createdAt', label: 'Created', byDefault: true, hideMobile: true },
  ],
  DOCUMENT: [
    { key: 'name', label: 'Name', fixed: true },
    { key: 'category', label: 'Category', byDefault: true, hideMobile: true },
    { key: 'mimeType', label: 'Type', byDefault: true, hideMobile: true },
    { key: 'sizeBytes', label: 'Size', byDefault: true, align: 'right', hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'createdAt', label: 'Uploaded', byDefault: true, hideMobile: true },
  ],
  FOLLOWUP: [
    { key: 'title', label: 'Task', fixed: true },
    { key: 'lead', label: 'Lead', byDefault: true, hideMobile: true },
    { key: 'dueAt', label: 'Due', byDefault: true },
    { key: 'priority', label: 'Priority', byDefault: true, hideMobile: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'actions', label: '', byDefault: true, align: 'right' },
  ],
  FIELDVISIT: [
    { key: 'rep', label: 'Rep', fixed: true },
    { key: 'lead', label: 'Lead', byDefault: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'plannedAt', label: 'Planned', byDefault: true, hideMobile: true },
    { key: 'checkInAt', label: 'Check in', byDefault: true, hideMobile: true },
    { key: 'duration', label: 'Duration', byDefault: true, align: 'right', hideMobile: true },
    { key: 'distanceMeters', label: 'Distance', byDefault: true, align: 'right', hideMobile: true },
    { key: 'geofenceOk', label: 'Geofence', byDefault: true, hideMobile: true },
    { key: 'outcome', label: 'Outcome', byDefault: true, hideMobile: true },
  ],
  PROJECT: [
    { key: 'name', label: 'Project', fixed: true },
    { key: 'code', label: 'Code', hideMobile: true },
    { key: 'micromarket', label: 'Micromarket', byDefault: true },
    { key: 'developer', label: 'Developer', byDefault: true, hideMobile: true },
    { key: 'priceBand', label: 'Price', byDefault: true, align: 'right' },
    { key: 'pricePerSqft', label: 'Rate / sqft', byDefault: true, align: 'right', hideMobile: true },
    { key: 'possession', label: 'Possession', byDefault: true },
    { key: 'availability', label: 'Available', byDefault: true, align: 'right' },
    { key: 'status', label: 'Status', byDefault: true, hideMobile: true },
    { key: 'unitTypes', label: 'Unit types', hideMobile: true },
    { key: 'flags', label: 'Flags', hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
  LISTING: [
    { key: 'reference', label: 'Ref', fixed: true },
    { key: 'title', label: 'Listing', fixed: true },
    { key: 'listingType', label: 'For', byDefault: true },
    { key: 'propertyType', label: 'Type', byDefault: true, hideMobile: true },
    { key: 'priceCell', label: 'Price', byDefault: true, align: 'right' },
    { key: 'beds', label: 'Beds', byDefault: true, align: 'right', hideMobile: true },
    { key: 'micromarket', label: 'Micromarket', byDefault: true },
    { key: 'status', label: 'Status', byDefault: true },
    { key: 'mandate', label: 'Mandate', byDefault: true, hideMobile: true },
    { key: 'areaSqft', label: 'Area', align: 'right', hideMobile: true },
    { key: 'propertyOwner', label: 'Owner', hideMobile: true },
    { key: 'updatedAt', label: 'Updated', hideMobile: true },
  ],
};

export function isGridObject(value: string): value is GridObject {
  return (GRID_OBJECTS as readonly string[]).includes(value);
}

/** Keys that may be reordered or removed, in catalogue order. */
export function optionalColumns(object: GridObject): ColumnDef[] {
  return GRID_COLUMNS[object].filter((column) => !column.fixed);
}

/**
 * Turns a stored key list into columns to render.
 *
 * Fixed columns always lead, whatever the stored order says. Stored keys that are
 * no longer in the catalogue are dropped rather than rendered as blanks, and an
 * empty or absent preference falls back to the product default — so a workspace
 * that has never configured anything, and one whose configuration has gone stale,
 * both end up with a usable grid instead of an empty one.
 */
export function resolveColumns(object: GridObject, stored: unknown): ColumnDef[] {
  const catalogue = GRID_COLUMNS[object];
  const byKey = new Map(catalogue.map((column) => [column.key, column]));
  const fixed = catalogue.filter((column) => column.fixed);

  const keys = Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [];
  const chosen = keys
    .map((key) => byKey.get(key))
    .filter((column): column is ColumnDef => column !== undefined && !column.fixed);

  const deduped = chosen.filter((column, index) => chosen.findIndex((c) => c.key === column.key) === index);
  if (deduped.length === 0) return [...fixed, ...catalogue.filter((column) => column.byDefault)];
  return [...fixed, ...deduped];
}

/** Reads the stored preference for one object out of the settings blob. */
export function storedColumnsFor(gridColumns: unknown, object: GridObject): unknown {
  if (!gridColumns || typeof gridColumns !== 'object') return null;
  return (gridColumns as Record<string, unknown>)[object] ?? null;
}
