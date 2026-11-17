# Who may grant what: rank is capped, reach is not

## What

Characterisation tests recording that **every path which gives somebody a role
checks rank and none checks scope** — and that the omitted-scope default is not
the mechanism.

`apps/web/tests/permission/grant-ceiling.spec.ts`, 4 cases. No behaviour
changed: this is the answer to "prove that callers cannot omit `scopeType` to
obtain or grant broader access than they are authorized to grant."

**They can. But omitting is not how.**

## Why

Three entry points, one rule between them:

| Path                                                | Check                                         |
| --------------------------------------------------- | --------------------------------------------- |
| `assignRole` → `assertMayGrantRole` (`roles.ts:40`) | `role.rank` vs `ctx.actor.roleRank`           |
| `changeUserRole` (`accounts.ts:698`)                | `role.rank <= ctx.actor.roleRank` → Forbidden |
| Invitations (`invitations.ts:78`)                   | `assertMayAdministerRole(ctx, role.rank, …)`  |

All rank. **Rank and scope are orthogonal:** a rank-60 "Sales Agent" role can
carry ORGANIZATION-scoped permission rows. So an administrator whose own
authority is one branch may hand out a role that reads the whole workspace —
conferring reach they do not themselves have.

The tests demonstrate it with a branch-scoped administrator
(`roles:MANAGE_CONFIGURATION` at `BRANCH`) assigning a rank-60 role:

- **omitting** `scopeType` → the assignment is `ORGANIZATION`;
- **naming** `ORGANIZATION` explicitly → identical result.

The third case asserts those two outcomes are the same, and that is the point.
**Closing the omitted-scope path would change nothing**, because the explicit
path is equally open. A fix has to be a **ceiling**, not a default — which is
why this change adds no ceiling and asks instead.

## Where

- `apps/web/tests/permission/grant-ceiling.spec.ts` — new, 4 cases, no
  production code touched.

## Behaviour

Unchanged, deliberately.

## Verified

4 passed. They pass because they record what happens today; they will fail the
moment a ceiling is added, which is when they should be rewritten as the
specification of it.

## Left open — the decision

**Should an assigner's own scope cap what they may grant?**

It is not obviously a defect. Roles are designed by whoever administers the
workspace; a branch manager assigning an existing "Sales Agent" is using a role
somebody senior defined, and capping it would stop them onboarding an agent who
legitimately needs a workspace-wide read.

It is not obviously safe either: it is the one way an administrator confers
reach they do not hold.

Three answers are defensible, and they are not equivalent:

1. **Leave it.** Role _definition_ is the control; assignment is clerical.
2. **Cap the assignment at the assigner's own scope** for the capability that
   authorises it (`roles:MANAGE_CONFIGURATION`). A BRANCH administrator may
   assign at BRANCH or narrower. Simple, and it would break a branch manager
   onboarding somebody who needs more.
3. **Cap per permission** — the assignment may not confer any permission at a
   wider scope than the assigner holds for that same permission. Most precise,
   most code, and it makes "what will this grant?" hard to show before saving.

This is a business decision about delegation, not a bug with an obvious fix, so
it is stated rather than chosen. The six-role matrix needs the answer, because
Sales Manager's authority over their team depends on it.
