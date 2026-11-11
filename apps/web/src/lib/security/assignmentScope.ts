import type { Scope } from './rbac';

/**
 * Where an additional role assignment applies.
 *
 * The assignment scope answers "where does this role apply"; the role's own
 * permission rows answer "what may it do there". A Branch Manager role assigned
 * for one branch must not confer its ORGANIZATION-scoped reads everywhere.
 *
 * ── Why this lives in one file ──────────────────────────────────────────────
 *
 * `MembershipRole.scopeType` is a `String` column, so nothing in the database
 * constrains it. The API used to validate it as `z.string().max(40)` and the
 * resolver used to map an unrecognised value to `ORGANIZATION` — the column's
 * default — which meant `BRACNH` was accepted silently and conferred the role's
 * scopes **unnarrowed at workspace level**. A typo widened access and said
 * nothing.
 *
 * The set of valid values, what each caps at, and which of them need an id are
 * stated here once, and the route, the service and the resolver all read them
 * from here so they cannot drift apart again.
 */

/** What each assignment scope caps the role's own permission scopes at. */
export const ASSIGNMENT_SCOPE_CAP = {
  ORGANIZATION: 'ORGANIZATION',
  REGION: 'REGION',
  BRANCH: 'BRANCH',
  TEAM: 'TEAM',
  DEPARTMENT: 'TEAM',
  DIRECT_REPORTS: 'TEAM',
  OWN: 'OWN',
  OWN_RECORD: 'OWN',
} as const satisfies Record<string, Scope>;

export type AssignmentScope = keyof typeof ASSIGNMENT_SCOPE_CAP;

/** Every accepted value, for the route's enum and for error messages. */
export const ASSIGNMENT_SCOPES = Object.keys(ASSIGNMENT_SCOPE_CAP) as [AssignmentScope, ...AssignmentScope[]];

/**
 * The scopes that name a particular thing, and the table that thing lives in.
 *
 * `BRANCH` without a branch is not a narrower grant — the resolver pools branch
 * ids from assignments that carry one, so a `BRANCH` row with no `scopeId`
 * contributes nothing to the pool while still capping at BRANCH. That reads as
 * "this role applies to no branch", which nobody means when they pick it.
 */
export const SCOPE_TARGET = {
  REGION: 'region',
  BRANCH: 'branch',
  TEAM: 'team',
  DEPARTMENT: 'department',
} as const;

export type ScopedTarget = keyof typeof SCOPE_TARGET;

export const scopeNeedsId = (scope: string): scope is ScopedTarget => scope in SCOPE_TARGET;

/**
 * The cap for a stored value, or `null` when it is not one we recognise.
 *
 * `null` means **fail closed**: the caller grants nothing from that assignment.
 * It cannot mean ORGANIZATION. A value that is not in the list was never
 * written deliberately — the three other writers of this column
 * (`accounts.ts`, `invitations.ts`, `createWorkspace.ts`) omit it and take the
 * `ORGANIZATION` default, which is a value we do recognise.
 */
export function scopeCapFor(value: string): Scope | null {
  return value in ASSIGNMENT_SCOPE_CAP ? ASSIGNMENT_SCOPE_CAP[value as AssignmentScope] : null;
}
