/**
 * The product modules, as a person choosing them sees them.
 *
 * Three platform screens offered this choice and each carried its own hand-typed
 * list: the plan form, the new-workspace wizard and the workspace editor. Adding
 * REAL_ESTATE to the schema, the entitlement union, the navigation and the
 * routes therefore left every one of them still offering two modules — so a plan
 * could not include Real Estate, no workspace could be entitled to it, and the
 * entire module was unreachable in production despite being deployed. Nothing
 * failed; the checkbox simply was not there.
 *
 * `ModuleKey` in the schema stays authoritative. This is the one place that says
 * what each key is *called* and what it sells, and the three screens read it
 * rather than restating it. `tests/unit/module-keys.spec.ts` checks it against
 * the enum, so a module added to the schema and not named here fails there
 * instead of quietly missing a checkbox.
 *
 * Deliberately free of server imports — `entitlements.ts` reaches for Prisma and
 * Redis, and two of the three consumers are client components. The refusal
 * wording lives there (`MODULE_LABEL`, "HR is not enabled for this company");
 * these are the shop-window labels, which is a different voice for a different
 * reader.
 */
/**
 * The module keys, as a closed tuple.
 *
 * Exported for `z.enum` on the platform APIs, which validated against their own
 * `['HRMS', 'SALES']` literals. That is the same duplication as the three
 * screens, one layer down and with a worse failure: the wizard offered Real
 * Estate, the API refused the request, workspace creation failed, and the E2E
 * suite saw every subsequent sign-in return 401 with nothing naming the cause.
 */
export const PRODUCT_MODULE_KEYS = ['HRMS', 'SALES', 'REAL_ESTATE'] as const;

export type ProductModuleKey = (typeof PRODUCT_MODULE_KEYS)[number];

export interface ModuleChoice {
  /** The `ModuleKey` value stored and sent in form data. */
  value: ProductModuleKey;
  /** What the module is called on screen. */
  label: string;
  /** One line on what it covers, for the screens that show more than a tick. */
  description: string;
}

export const PRODUCT_MODULE_CHOICES: readonly ModuleChoice[] = [
  {
    value: 'HRMS',
    label: 'People / HRMS',
    description: 'Employees, attendance, leave, shifts, documents and organisation.',
  },
  {
    value: 'SALES',
    label: 'Sales CRM',
    description: 'Leads, opportunities, accounts, activities, campaigns and reporting.',
  },
  {
    value: 'REAL_ESTATE',
    label: 'Real Estate',
    description: 'Brokerage leads, property inventory, site visits, bookings and commissions.',
  },
];
