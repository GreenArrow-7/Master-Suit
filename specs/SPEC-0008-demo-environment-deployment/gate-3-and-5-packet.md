# SPEC-0008 revision 3 — gate 3 and gate 5 packets

| Field | Value |
|---|---|
| Specification | `SPEC-0008` revision 3 |
| Prepared | 2026-09-09, against `e426b8f` (CI **success**) |
| Recorded so far | gate 1 ✅, gate 2 ✅ — revision 3 only |
| This packet asks for | **gate 3** and **gate 5**; gate 4 identified below |

**Nothing here is recorded as approved.** An agent prepared it and holds none of
it. `sdd.json` carries two approvals and will carry only what a human states.

**Design approval is not security verification.** Gate 3 accepts a *design and
its residual risk* on the evidence below. It does not certify the implementation,
which does not exist. Final security verification is gate 6 convergence, after
implementation, against tests that have actually run on the candidate. Approving
gate 3 does not pre-approve gate 6.

---

# Gate 3 — security risk acceptance

**Role: Application Security.**

## What is verified today, by test

All against local disposable databases; `e426b8f` CI green.

**Database layer — `tests/tenant/demo-tenant-boundary.spec.ts`, 10 passing**,
as `master_saas_app` (`NOBYPASSRLS`, asserted):

- demo → customer and customer → demo lead reads both return zero rows;
- unpinned reads, forged tenant ids and post-transaction reads return zero rows
  — the policy fails closed;
- all seven BOOTSTRAP tables confirmed to carry no policy;
- `PlatformUser` confirmed to have no `tenantId` column.

**Application layer — `tests/tenant/demo-application-boundary.spec.ts`, 13
passing**, real sessions, real `resolveCtx`, real route handlers, **no mocked
authorization**:

- a session minted for the demo principal **naming customer A as its active
  tenant** is refused;
- demo sees only its own workspace and holds no customer membership row;
- the platform control plane is refused; `platformRole` unchanged after;
- demo `DELETE` and `PATCH` against a customer integration are refused with row
  count, `status` and credential marker unchanged;
- no list response exposes a credential marker, including the caller's own;
- positive controls asserted at 200 for all three parties, so a blanket failure
  cannot make the suite look secure.

## The security question being asked

For the seven BOOTSTRAP tables, `master_saas_app` holds full DML and no policy
applies. **Application authorization is the entire boundary**, and the proposal
puts a public login on the far side of it.

`non-rls-table-assessment.md` examines each table separately rather than
issuing one verdict. Summary: every exemption is individually justified; two
produce first-release policy work (deny the demo tenant API-key and invitation
creation); one produces a follow-up (splitting `IntegrationConnection` so the
webhook bootstrap exposes a key-to-tenant mapping rather than every tenant's
credentials); none is recommended for RLS in this release.

## Limitations, stated plainly

1. **The measured evidence covers the boundary as it stands, not the demo
   policy** — no demo policy exists yet, so nothing here proves outbound
   suppression works. That is gate 6's job.
2. **`IntegrationConnection`'s exemption is wider than its justification.**
   Accepted here on measured application-layer refusals, with the narrowing
   recorded as a follow-up rather than bundled in.
3. **Worker paths are unproven.** `workers/notifications.ts:108` reaches
   `sendMail` with no request context. The design routes it through the same
   policy resolver; that is a design claim, not yet a test.
4. **[UNKNOWN] production runtime state** — effective RLS, role attributes,
   `EMAIL_PROVIDER`, and whether `demo@youhan.in` or `youhan-one-demo` already
   exist. None is obtainable from the repository.
5. **Shared-resource risk is real** — one Postgres, one Redis, one worker.
   `AC-D11` limits it; it does not eliminate it.

## Tenant-scoped outbound restrictions

`demoPolicyFor(tenantId)` resolved server-side and consulted **at the point the
effect happens**, so workers and retries are covered by the same rule; rejects
rather than proceeds when context or policy cannot be established.

| Surface | First-release rule |
|---|---|
| `calls/[id]/follow-up-email` → `sendMail` | **suppress**, record intent |
| `workers/notifications.ts` → `sendMail` | **suppress**, record intent |
| `auth/forgot-password` → `sendMail` | **preserve** — global account flow |
| `identity/invitations` → `sendMail` | **preserve** globally; demo may not invite |
| `src/lib/integrations/**` | **suppress** for demo tenants |
| API keys | demo may not create |

**Production environment settings unchanged.** `EMAIL_PROVIDER` stays `smtp`;
nothing switches to `mock`. Customer authentication and notifications are
preserved by explicit rule, never blanket-blocked — `AC-D6` proves this
positively.

## Requested decision

> **Approved:** the security design of `SPEC-0008` revision 3, including the
> per-table assessment in `non-rls-table-assessment.md` and the five limitations
> above; specifically that for the seven BOOTSTRAP tables application
> authorization is the whole boundary, accepted on the measured evidence in
> `demo-application-boundary.spec.ts`; that `IntegrationConnection` is narrowed
> by a follow-up rather than in this release; and that the demo tenant is denied
> API-key and invitation creation in the first release.
>
> **This is design approval, not security verification.** It does not accept the
> implementation, which does not exist, and does not pre-approve gate 6.

---

# Gate 4 — identified, not requested here

**Read from `docs/sdd/HUMAN_APPROVAL_GATES.md:47-53`, not inferred:**

> **4. Data model and destructive migration approval** — that the schema change
> is sound and the data operation is safe. Additive migration at R3: Solution
> Architect. Destructive, backfilling or long-locking migration at R5: Solution
> Architect **and** DevOps **and** Human Release Authority, with the rollback
> and restore path written down first. `AGENTS.md` §4 forbids an agent from
> executing these against production in any case.

**Scope for this change:** one additive column, `Tenant.kind`, default
`CUSTOMER`. No backfill, no destructive operation. The document's escalation is
keyed to *destructive, backfilling or long-locking*, not to the surrounding
risk level, so the additive branch applies: **approver, Solution Architect.**

**One claim to verify at implementation, not assert now:** adding a column with
a non-volatile default is metadata-only on PostgreSQL 11+ and does not rewrite
the table. If the column were `NOT NULL` without a default it *would* rewrite
and become long-locking — which would move this to the R5 branch and three
approvers. The migration must be written the first way and the plan shown to
gate 4.

**Timing:** before the migration is written, alongside gate 5. It is not
requested in this packet because the migration is not yet drafted.

---

# Gate 5 — implementation readiness

**Role: Solution Architect.** Separate permission to start writing code,
additional to gate 1 (`HUMAN_APPROVAL_GATES.md:55-58`).

## Exact planned changes

| File | Change | Unit |
|---|---|---|
| `apps/web/prisma/schema.prisma` + migration | additive `Tenant.kind`, default `CUSTOMER` | R4 |
| `apps/web/src/lib/tenant/demo-policy.ts` *(new)* | `demoPolicyFor(tenantId)`, fail-closed | R4 |
| `apps/web/src/lib/mailer.ts` | tenant-aware suppression at `sendMail` | R4 |
| `apps/web/src/workers/notifications.ts` | policy check at execution | R4 |
| `apps/web/src/lib/integrations/registry.ts` | policy check before any vendor call | R4 |
| `apps/web/src/services/…/provision-demo.ts` *(new)* | idempotent, conflict-refusing | R4 |
| `apps/web/src/lib/auth/*` | demo cannot gain membership, platform role, API keys or invitations | R4 |
| `apps/web/tests/**` | `ST-D6`–`ST-D16` | R2 |

**Not touched:** `.github/workflows/*`, `apps/web/infra/*`, DNS, Caddy,
production environment variables.

## Tests required before convergence

`ST-D6` platform denial · `ST-D7` outbound suppression, request path ·
`ST-D8` outbound suppression, **worker and retry** · `ST-D9` customer mail and
integrations still fire, **positive** · `ST-D10` provisioning idempotence and
conflict refusal · `ST-D11` reset unreachable · `ST-D12` operator disable
including queued work · `ST-D13` demo limits · `ST-D14`–`ST-D16` identity and
control-plane boundaries.

`ST-D1`–`ST-D5` are **already implemented and passing** at `e426b8f`.

## First release: provisioning, disable, reset, rollback

- **Provisioning** — idempotent; refuses a slug or address held by a non-demo
  tenant; refuses to repurpose an existing customer tenant; credentials through
  the approved secret mechanism, never committed or logged. **R5 when run
  against production: humans execute.**
- **Reset — disabled**, and unreachable for the demo account through every
  existing endpoint and job. Not merely unimplemented.
- **Operator disable** — refuses new demo sessions, terminates active ones,
  drains or cancels queued demo side effects.
- **Rollback ordering, and the order is the control:** disable demo access →
  drain queued demo side effects → verify none in flight → **then** roll back.
  A downgrade to a build without demo restrictions while an accessible demo
  tenant exists removes every suppression and leaves the login live. Image
  rollback alone is insufficient; the additive column stays and old code ignores
  it.

## Requested decision

> **Approved:** implementation may begin on the files listed above, at `R4`, in
> a candidate branch. Production operations remain `R5` and are executed by
> humans, per `CL-R3-01`. Gate 4 is required before the migration is written.
> No test may be weakened to accommodate the change.

---

# What is still missing

| Gate | Role | Status |
|---|---|---|
| 3 Security | Application Security | **requested above** |
| 4 Data model | Solution Architect | identified; request when the migration is drafted |
| 5 Implementation readiness | Solution Architect | **requested above** |
| 6 Convergence | Application Security (security findings at R4) | after implementation |
| 7 Release | Human Release Authority | after convergence |

**Unchanged and not closed:** `EVC-020`, `EVC-021`, `EVC-023`, `EVC-024`.
`SPEC-0009` is `CONVERGED` awaiting gate 7. Production is untouched.
