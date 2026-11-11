# What the authorization system already does, before anyone designs six roles on top of it

## What

[docs/roles/ROLE-INVENTORY.md](../docs/roles/ROLE-INVENTORY.md) — the permission
catalogue, scope resolution, multi-role support, module entitlements, the
mandatory restrictions already implemented, sensitive-field handling and what a
real workspace is provisioned with today. Every claim carries a file and line.

Phase 1 of the brokerage role model. **No code changed**, and no matrix designed
yet: the inventory decides the design, so it comes first.

## Why

Three findings change what the six-role model has to be.

**Multi-role is already supported end to end** — `MembershipRole` with
effective dates and its own scope, a resolver that unions grants and keeps the
strongest scope per `module:ACTION`, an assign/revoke API and a UI with
revocable history. Phase 3 reuses it. Nothing new is needed, which is the most
useful thing an inventory can report.

**`scopeType` is an unvalidated string that fails open.** The schema defaults it
to `ORGANIZATION`, the route validates it as `z.string().max(40).optional()`,
and an unrecognised value falls through to `ORGANIZATION` in the resolver. A
typo — `BRACNH` for `BRANCH` — is accepted silently and confers the role's
scopes **unnarrowed at workspace level**. This is a defect in its own right, not
a design input, and it undermines any scoped assignment the new model relies on.

**A role can grant what the subscription does not include.** `createWorkspace`
gives Company Administrator every `Permission` row at `ORGANIZATION` regardless
of purchased modules, the matrix editor's only ceiling is the administrator's
own scope, and roughly thirty `/api/v1` route files declare no `productModule`
with no coverage check to catch them — unlike permissions, which have
`scripts/check-permission-catalogue.ts`. "A role must not bypass subscription
restrictions" is a requirement the code does not currently meet.

Also worth knowing before designing: the 26-role matrix in `prisma/seed/roles.ts`
is **demo-only**. A real workspace gets `company_admin` plus five Lead Eagle
starter roles. `sales_director`, `branch_manager`, `finance_admin` and `auditor`
do not exist in a customer workspace, so there is no existing role to map them
onto.

## Where

- `docs/roles/ROLE-INVENTORY.md` — new, sections A–G plus a verification pass.

## Behaviour

No change. Investigation only.

## Verified

The inventory was produced by a delegated agent and then spot-checked, with the
result recorded in the document rather than quietly folded in:

- **`scopeType` fails open** — confirmed at schema, route and resolver.
- **Multi-role support** — confirmed.
- **"Nothing guards the money approvals"** — **wrong, and corrected.** Three of
  four are guarded in `src/services/money/`, which the agent did not search:
  `collections.ts:456`, `payouts.ts:191`, `feeAmendments.ts:354`,
  `recoveryCases.ts:279`. Only `commissions.ts` confirms on a permission check
  alone.

## Left open

- **The matrix itself.** Deliberately not started until these findings were in.
- **Commissions self-approval.** The sharper question is not maker-checker but
  whether the agent a commission is payable _to_ may confirm it while holding
  `commissions:APPROVE`. Reachability depends on the matrix, so it is both a
  gap and an input to the decision.
- **`FieldPermission` reads the primary role only** while `VIEW_SENSITIVE_FIELDS`
  combines across roles — the two halves of sensitive-data control disagree
  about multi-role.
- **Branch and region grants pool across assignments**, so two branch-scoped
  roles mean either branch at any BRANCH-scoped permission. It bites exactly
  when one person covers two branches with different authority.
