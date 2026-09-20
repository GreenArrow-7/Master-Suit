/**
 * The modules of YOUHAN ONE as the ecosystem graphic draws them.
 *
 * One list, so the sign-in hero, a phone's compact version and — later — empty
 * states, onboarding and the mobile apps all name the same parts in the same
 * order. Positions are in the graphic's own 560×400 space; the compact variant
 * picks a subset and re-places it.
 */
export type ModuleId =
  'sales' | 'people' | 'operations' | 'communication' | 'automation' | 'analytics' | 'tasks' | 'ai';

export interface EcosystemModule {
  id: ModuleId;
  label: string;
  x: number;
  y: number;
}

export const CORE = { x: 280, y: 200, r: 36 } as const;

export const MODULES: EcosystemModule[] = [
  { id: 'tasks', label: 'Tasks', x: 280, y: 48 },
  { id: 'sales', label: 'Sales', x: 118, y: 92 },
  { id: 'people', label: 'People', x: 442, y: 92 },
  { id: 'communication', label: 'Communication', x: 56, y: 200 },
  { id: 'operations', label: 'Operations', x: 504, y: 200 },
  { id: 'automation', label: 'Automation', x: 118, y: 308 },
  { id: 'analytics', label: 'Analytics', x: 442, y: 308 },
  { id: 'ai', label: 'AI intelligence', x: 280, y: 352 },
];

/**
 * The story the motion tells, in order: what one lead sets in motion across the
 * platform. Each step lights a module and names what happened there.
 */
export const STORY: { module: ModuleId; caption: string }[] = [
  { module: 'sales', caption: 'Lead created' },
  { module: 'tasks', caption: 'Task assigned' },
  { module: 'people', caption: 'Team notified' },
  { module: 'automation', caption: 'Workflow triggered' },
  { module: 'ai', caption: 'Call analysed' },
  { module: 'analytics', caption: 'Dashboard updated' },
];

/**
 * Phone-sized version: the core and four modules on a shorter 560×280 canvas,
 * the same story in three steps. Larger nodes, because the whole graphic is
 * drawn at roughly a third of the desktop size.
 */
export const COMPACT_VIEWBOX = { w: 560, h: 280 } as const;
export const COMPACT_CORE = { x: 280, y: 140, r: 40 } as const;
export const COMPACT_MODULES: EcosystemModule[] = [
  { id: 'sales', label: 'Sales', x: 124, y: 62 },
  { id: 'people', label: 'People', x: 436, y: 62 },
  { id: 'operations', label: 'Operations', x: 124, y: 206 },
  { id: 'ai', label: 'AI', x: 436, y: 206 },
];

export const COMPACT_STORY: { module: ModuleId; caption: string }[] = [
  { module: 'sales', caption: 'Lead created' },
  { module: 'people', caption: 'Team notified' },
  { module: 'ai', caption: 'Call analysed' },
];

/** Seconds per story step and the length of one full cycle. */
export const STEP_SECONDS = 2.4;
export const cycleSeconds = (steps: number) => steps * STEP_SECONDS;
