/**
 * The person-shaped fields HR screens are allowed to see.
 *
 * `include: { platformUser: true }` means *every* scalar column, and both
 * PlatformUser and User carry `passwordHash`, `mfaSecret` and
 * `mfaRecoveryCodes`. Twenty-odd HR queries did exactly that and returned the
 * lot through the API, so a live TOTP secret for every employee was readable by
 * anyone holding `hrms:VIEW`.
 *
 * These constants exist so the safe shape is written once and reused. A new HR
 * query should import from here rather than reach for `include: true` again.
 */

export const PLATFORM_USER_PUBLIC = {
  id: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  phone: true,
  status: true,
} as const;

export const SALES_USER_PUBLIC = {
  id: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  phone: true,
  status: true,
  jobTitle: true,
  employeeCode: true,
  managerId: true,
} as const;

/** Membership carrying just the identity fields, no credentials. */
export const MEMBERSHIP_PUBLIC = {
  select: {
    id: true,
    tenantId: true,
    status: true,
    roleSnapshot: true,
    isPrimaryAdmin: true,
    platformUserId: true,
    salesUserId: true,
    platformUser: { select: PLATFORM_USER_PUBLIC },
  },
} as const;

/** As above, plus the workspace role — what employee lists render. */
export const MEMBERSHIP_WITH_ROLE_PUBLIC = {
  select: {
    id: true,
    tenantId: true,
    status: true,
    roleSnapshot: true,
    isPrimaryAdmin: true,
    platformUserId: true,
    salesUserId: true,
    platformUser: { select: PLATFORM_USER_PUBLIC },
    salesUser: { select: { ...SALES_USER_PUBLIC, role: true } },
  },
} as const;

/** `employee: { include: { membership: ... } }` → the safe equivalent. */
export const EMPLOYEE_WITH_PERSON = { include: { membership: MEMBERSHIP_PUBLIC } } as const;
