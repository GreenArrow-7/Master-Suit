# The nine contaminated roles: an inventory and a reversible remedy, neither of them a delete

## What

[docs/qa/REVIEW-DEMO-ROLE-REMEDIATION.md](../docs/qa/REVIEW-DEMO-ROLE-REMEDIATION.md).
Four read-only queries that turn a pattern match into a decision, the
remediation to approve, and the two conditions under which it must not run.

## Why

Nine roles matching the end-to-end suite's generators are in the workspace
`review-demo`, created 19–20 September 2026 — seven of them inside twenty
minutes. That is a suite being run repeatedly against this environment, not a
workspace being configured.

**It is also not authorisation to delete anything.** A regex and a timestamp say
"this looks generated"; they do not say who holds the role, what it grants, or
whether a real person is relying on it. The queries answer those, in that order,
before anything is decided.

**The remedy is `Role.isActive`, which the product already has.** Its schema
comment says what it does: "A deactivated role grants nothing and cannot be
assigned, but keeps its history." `src/services/identity/roles.ts` then:

- drops it from the **Add user** picker, which filters `isActive: true` — the
  dropdown entries the reporter photographed disappear;
- keeps the role, its permissions and every historical reference;
- writes a `PERMISSION_CHANGED` audit row with the before and after;
- **signs out everyone holding it**, so no live session keeps permissions it has
  just lost.

That last one is why the inventory comes first and why the SQL fallback refuses
a role with holders. Deactivating a role somebody is actually using logs them
out — the right behaviour, and a customer impact that needs a decision rather
than a script.

Deletion was rejected: it loses the audit trail that says the roles existed, and
a role id may be referenced by history nothing here has enumerated.

## Where

- `docs/qa/REVIEW-DEMO-ROLE-REMEDIATION.md` — new. Nothing executable, nothing
  destructive, every statement in §1–§4 a `SELECT`.

## Behaviour

No application change.

## Verified

- `Role.isActive` honoured by the Add-user picker — `people/users/new/page.tsx`
  filters `isActive: true`.
- Deactivation revokes sessions and audits — `services/identity/roles.ts`.
- Deactivating a system role is refused — same file.
- `DeviceToken.platform = 'ios'` is what answers "which workspace is the phone
  signed in to". The first draft of that query named a `DeviceSession` table
  that does not exist; it was checked against the schema and corrected before
  the document was finished.

## Left open

The queries have **not been run** — they need the production database, which
this session does not reach. The nine remain active until somebody runs §1,
reads it, and decides.

And the open question the inventory cannot answer: **who pointed the suite at
this environment on 19 September, and is that still possible?** The generator is
fixed and CI runs against a throwaway database, but nothing stops a developer
exporting `E2E_DEMO_SLUG` and running it by hand.
