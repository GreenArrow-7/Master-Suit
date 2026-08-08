# Security Findings — Master SaaS

**Assessment date:** 2026-08-08
**Target:** `apps/web` (Next.js 16 / Prisma 7 / PostgreSQL / Redis / MinIO), `apps/face`
**Environment:** local development — `NODE_ENV=development`, `APP_URL=http://localhost:3000`,
Postgres/Redis/MinIO healthy in Docker. Confirmed non-production before any mutating test.
**Method:** source review, then dynamic verification against the real database via the
project's own vitest harness. Every claim below is labelled with how it was established.

> **Note on the brief.** The engagement described a FastAPI/SQLAlchemy/vanilla-JS
> application. This repository is Next.js 16 + Prisma 7 + TypeScript. The assessment was
> adapted to the architecture that exists; the FastAPI- and SQLAlchemy-specific phases are
> NOT APPLICABLE and are recorded as such rather than silently dropped.

> **Note on scope validity — the working tree changed during this assessment.** Files
> appeared mid-session: `services/hr/payroll.ts`, `services/hr/wps.ts`, the
> `hr/payroll/{runId}/wps` route, `20260808160000_hr_payroll`, a telephony refactor and
> `lib/security/envelope.ts` were not all present when discovery ran. The test count moved
> from 483 (baseline) to 517 (final); only 4 of those are mine. Consequences, stated plainly:
>
> * Payroll and WPS were reviewed, but **later** than the rest and against a moving target.
> * The newest arrivals — `envelope.ts`, `ingestRecording.ts`, `workers/media.ts`, the
>   telephony registry, and the `20260808160000_hr_payroll` migration — were **NOT reviewed**.
> * F-01 and its fix were verified against the tree as it stands now (confirmed still present
>   and green at 517/517), so that conclusion holds regardless.
>
> A re-run against a quiesced tree is advisable before release sign-off.

## Evidence labels

| Label | Meaning |
|---|---|
| **TESTED** | Executed and verified against a running database. |
| **CODE-VERIFIED** | Established by tracing source; not dynamically executed. |
| **NOT TESTED** | Not exercised. A reason is always given. |
| **N/A** | The feature does not exist in this codebase. |

---

## Executive summary

This is a mature, security-conscious codebase. Authorization is centralised in a single
route kernel, tenant isolation is three layers deep with Postgres RLS underneath it, and
the boot sequence refuses to start a misconfigured production server. Much of what a
review like this normally finds has already been found here and fixed, with the reasoning
left in the comments.

**One confirmed vulnerability was found, exploited, fixed, and covered by a regression
test.** It is in the newest, least-reviewed code — the uncommitted overtime module — and it
sits on the money path.

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| **High** | **1** | **Fixed + regression test** |
| Medium | 1 | Fixed (test integrity) |
| Low | 1 | Reported, not fixed (design decision for the owner) |
| Informational | 3 | Reported |

---

## HIGH — F-01: Overtime approval ignored permission scope

| | |
|---|---|
| **Severity** | HIGH |
| **Status** | **CONFIRMED → FIXED → REGRESSION TESTED** |
| **Component** | `apps/web/src/services/hr/overtime.ts` — `decideOvertime`, `listOvertime` |
| **Entry point** | `POST /api/v1/workspaces/{slug}/hr/actions/overtime-decide` |
| **CWE** | CWE-863 Incorrect Authorization, CWE-639 Authorization Bypass Through User-Controlled Key |
| **OWASP** | API1:2023 Broken Object Level Authorization; A01:2021 Broken Access Control |
| **Evidence** | **TESTED** — exploited against the real database before the fix |

### Description

`overtime:APPROVE` is granted at a *scope*. The module's own access layer documents what
the scope means:

> "TEAM scope and above is a line manager acting for their own reports; ORGANIZATION is HR
> acting for anyone." — `services/hr/access.ts`

Every sibling approval workflow honours that distinction:

- `decideLeave` refuses a request not assigned to the actor (`request.approverId !== self?.id`);
- `decideAttendanceException` refuses one from outside the actor's reporting line (`isLineManagerOf`).

`decideOvertime` checked only that the actor's **role held the permission at all**:

```ts
if (!isOvertimeApprover(ctx)) throw Forbidden(...);   // TEAM or above — that was the whole gate
...
if (actor && actor.id === claim.employeeId) throw Conflict(...);  // self-approval only
```

There was no check that the claim's employee was within the approver's reporting line. A
TEAM-scoped approver could decide **any overtime claim in the workspace**.

`listOvertime` had the matching read-side defect: `employeeId: approver ? filter.employeeId : self.id`
widened to the entire workspace for any approver at any scope, returning every employee's
claims together with the person record joined onto each.

### Why this is High, not Medium

This is the money path, and the escalation is silent:

1. Approving stamps a `multiplier` onto the claim and sets it `APPROVED`.
2. `approvedOvertimeMinutes` reads `APPROVED` rows and returns `weightedMinutes` — that is
   payroll's input, consumed by `payroll.ts` and locked into a payslip by `lockRun`.
3. The permission arrives by **backfill** in `20260808140000_hr_overtime`, derived from
   `attendance:APPROVE` at the same scope. That migration states it "is written to change
   nobody's effective access" — but the source authority *is* line-manager-constrained
   where it is spent, so the derived one granted strictly more than its source. Every
   existing workspace with a TEAM-scoped attendance approver silently acquired
   workspace-wide overtime signing authority on migration.

### Exploit path (confirmed)

`hrms:EDIT`@TEAM → (migration `20260807030000`) → `attendance:APPROVE`@TEAM →
(migration `20260808140000`) → `overtime:APPROVE`@TEAM → approve **anyone's** overtime.

### Proof

`tests/security/hr-overtime-scope.spec.ts` against unmodified code. A TEAM-scoped approver
decided a claim belonging to an employee who does not report to them; the row came back:

```
"status": "APPROVED",
"multiplier": 1.25,
"employeeId": <outsider>
```

— i.e. a payable, payroll-bound approval. The read test confirmed the outsider's claim was
also visible in the approver's queue.

### Root cause

The permission predicate `isOvertimeApprover` (`TEAM` or above) was used as though it meant
"may decide anything". There was no predicate expressing "may decide for *anyone*", so the
distinction the scope carries had nowhere to live.

### Remediation applied

Smallest correct fix, reusing the pattern the sibling workflow already established:

1. **`services/hr/leave.ts`** — `isLineManagerOf` promoted from a private helper in
   `requests.ts` to a shared export, alongside a new `reportingLine`. Both callers now
   share one definition; a second private copy is how the two drifted apart originally.
2. **`services/hr/requests.ts`** — imports the shared helper; its private copy deleted.
3. **`services/hr/access.ts`** — added `isOvertimeAdmin` (`overtime:APPROVE` at ORGANIZATION),
   making "may decide for anyone" expressible.
4. **`services/hr/overtime.ts`** —
   - `decideOvertime` now refuses unless the actor is an overtime admin, an HR admin, or
     the claim's line manager;
   - `listOvertime` scopes to three tiers: workspace (HR/ORGANIZATION), reporting line
     (line manager), self (everyone else).

Enforcement is server-side in the service layer, where every caller routes through —
not in the route handler, and not in the UI.

### Regression test

`tests/security/hr-overtime-scope.spec.ts` — 4 tests, permanent:

| Test | Before fix | After fix |
|---|---|---|
| TEAM approver cannot decide an outsider's claim | **FAIL** (approved it) | PASS |
| TEAM approver cannot see an outsider's claim in the queue | **FAIL** (saw it) | PASS |
| TEAM approver *can* decide their own report's claim | PASS | PASS |
| ORGANIZATION approver decides anyone (HR unaffected) | PASS | PASS |

The two positive controls are deliberate: they prove the fix restricts the attack without
breaking the approval the feature exists for.

---

## MEDIUM — F-02: Security tests could silently not run

| | |
|---|---|
| **Severity** | MEDIUM (test integrity — not an application vulnerability) |
| **Status** | **CONFIRMED → FIXED → VERIFIED** |
| **Component** | `apps/web/vitest.config.mts`, test suite |
| **Evidence** | **TESTED** |

The baseline run failed 3 tests in `tests/security/mfa-enrolment.spec.ts`, all asserting
`expected 429 to be 200`.

Root cause: `.env.test` sets `TRUSTED_PROXY_CIDRS=none` — correct, nothing fronts a test
process — so `clientIp()` returns null and every sign-in in the suite shares one bucket
keyed `login:ip:unknown`, capped at 10 per 15 minutes. Confirmed directly in Redis db15:

```
rl:login:ip:unknown:1984665 = 10   ttl=816
```

Within one run the ceiling is comfortable. Across runs it is not — a second `npm test`
inside the window starts with the budget spent.

**This is worse than ordinary flakiness.** A security assertion that never ran because the
request was refused upstream is indistinguishable from one that passed, and the same
collision can turn a genuine regression green.

**Classification: ENVIRONMENT/TEST defect, not an application flaw.** Production is
protected: `assertProxyConfiguration()` in `lib/startup-check.ts` calls `process.exit(1)` if
`TRUSTED_PROXY_CIDRS` is empty *or* `"none"`. **Verified by reading the enforcement, not the
comment claiming it.**

**Fix:** `tests/globalSetup.ts` clears `rl:*` from the test Redis before each run; wired
into `vitest.config.mts`. **Verified** by two back-to-back runs of the previously-failing
spec — 9/9 then 9/9, where the second previously failed.

---

## LOW — F-03: An overtime approver may approve a claim they raised

| | |
|---|---|
| **Severity** | LOW (segregation of duties) |
| **Status** | Reported — **not fixed**, owner's decision |
| **Component** | `services/hr/overtime.ts` — `decideOvertime` |
| **Evidence** | **CODE-VERIFIED** |

`decideOvertime` blocks self-approval by beneficiary (`actor.id === claim.employeeId`) but
does not consider `requestedById`. An approver may raise a claim on someone else's behalf
and then approve it themselves — a single person completing both halves of a two-person
control. The approver is not the beneficiary, so this is not self-enrichment, and
`decideLeave` has the same shape (so fixing only overtime would be inconsistent).

Left unfixed deliberately: it is a policy question, not a defect, and changing it would
alter legitimate small-workspace workflows where one person legitimately does both. If you
want it enforced, the check is one line — refuse when `claim.requestedById === actor.id`
and the actor is not an HR admin — and it should be applied to leave at the same time.

---

## INFORMATIONAL

**I-01 — Bootstrap credentials in the local `.env`.** `PLATFORM_OWNER_PASSWORD` holds a
real-looking password. `.env` and `.env.test` are correctly gitignored (only `.example`
templates are tracked — **TESTED** via `git ls-files`), so nothing leaked to version
control. The file's own comment says to rotate after first sign-in; worth confirming that
happened. No secret is reproduced in this report.

**I-02 — WPS export does not neutralise spreadsheet formulas.** `services/hr/wps.ts` →
`cell()` escapes the CSV delimiter and quotes (RFC 4180) but does not neutralise a leading
`=`, `+`, `-` or `@`. The SIF carries HR-entered identifiers (`wpsPersonId`, `bankAgentId`,
`iban`); one beginning with `=` would be evaluated if the file were opened in a spreadsheet
rather than handed to the bank's parser. Real but low: the consumer is a bank system, and
the fields are identifiers. Worth aligning because **this codebase already has the correct
helper** — `app/api/v1/leads/export/route.ts` → `csvCell()` prefixes such values with `'`.
The fix is that one line, applied to `cell()`.

**I-03 — Routes that bypass the API kernel.** 15 of 73 route files do not go through
`route()`, whose own docstring calls that "a review blocker". Each was checked and each has
a defensible reason — auth routes have no `Ctx` yet, webhooks are anonymous by design,
platform routes gate on `requirePlatformOwner`, and the file-returning routes (document
download/upload, leads export, WPS) cannot use a kernel that always answers JSON. **All of
them reimplement authentication, authorization and entitlement correctly**, verified
individually. Two observations rather than defects: the WPS export inherits no rate limit
from the kernel (a bulk bank-detail export is a reasonable thing to throttle), and each
bypass is a place where a future edit can silently drop a gate the kernel would have
enforced. `generateSif` does write an `EXPORT_REQUESTED` audit row, so the export is
attributable.

---

## Positive security controls verified

These were checked and found working. Listed because "no finding" should mean "looked, and
it held", not "did not look".

| Control | Evidence | Note |
|---|---|---|
| Tenant isolation, 3 layers | **TESTED** (`tests/tenant/*` pass) | Repo → guard extension → Postgres RLS |
| RLS actually applies | **CODE-VERIFIED** | Boot refuses superuser, `BYPASSRLS`, or owner-unforced tables |
| Production config gate | **CODE-VERIFIED** | `process.exit(1)` on empty/`none` proxy CIDRs, mock providers, shared migration role |
| Single route kernel | **CODE-VERIFIED** | Auth → rate limit → authorize → validate → handle → audit, in that order |
| Secret scrubbing on egress | **TESTED** (`secret-egress.spec.ts`) | Deep scrub with cycle handling; net under per-route selects |
| Document IDOR | **CODE-VERIFIED** | Non-owner gets `NotFound`, not `Forbidden` — no enumeration oracle |
| Upload safety | **CODE-VERIFIED** | Quarantine-first, magic-byte sniffing, generated storage keys, CLEAN-only release |
| Payroll maker-checker | **CODE-VERIFIED** | Preparer cannot approve own run; enforced on the record, not the role |
| Field security | **CODE-VERIFIED** | Masking + refusal to filter/sort on hidden fields (blocks binary-search recovery) |
| `X-Forwarded-For` handling | **TESTED** (`client-ip.spec.ts`) | Walked right-to-left; unparseable entries skipped |
| Login enumeration resistance | **CODE-VERIFIED** | Uniform response and `burnTiming()` on every failure path |
| MFA enrolment grant | **TESTED** (`mfa-enrolment.spec.ts`) | Restricted purpose; rejected everywhere except enrolment |
| Attendance replay/idempotency | **CODE-VERIFIED** | `(tenantId, employeeId, clientPunchUid)` unique; nonce spent before frames |
| Overtime detection idempotency | **TESTED** | DB unique constraint, not convention; races resolve to one row |
| Dependency vulnerabilities | **TESTED** | `npm audit --omit=dev` → **0 vulnerabilities** |
| Secrets in git | **TESTED** | No `.env`/`.env.test` tracked |

---

## Untested / blocked

Recorded rather than skipped, per the zero-skip rule.

| Area | Status | Reason |
|---|---|---|
| Playwright E2E (`tests/e2e/*`) | **NOT TESTED** | Needs a running app + browsers; not launched this session |
| Server integration (`tests/server/*`) | **NOT TESTED** | Separate config that boots a server; not run |
| Face match / liveness | **CODE-VERIFIED only** | `apps/face` service not running; `FACE_SERVICE_URL` unset — attendance fails closed with 503 by design |
| Antivirus (ClamAV) | **CODE-VERIFIED only** | `ANTIVIRUS_PROVIDER=mock` locally; observed connection-refused in logs. Production boot refuses `mock` |
| Concurrency / race tests | **PARTIAL** | Overtime detection and payroll locking rely on DB constraints and `withTx`; no dedicated barrier-based concurrent test written |
| Recruitment / ATS, performance reviews | **N/A** | No models, services or routes exist |
| SQLAlchemy / FastAPI phases | **N/A** | Wrong stack for this repository |
| Penetration of live HTTP surface | **NOT TESTED** | No app server started; all dynamic testing went through route handlers in-process |

---

## Residual risk

**Low, with one caveat.** The confirmed High is fixed and permanently covered. The
architecture's defence-in-depth is real rather than decorative — the boot-time RLS
verification in particular is a control most codebases only claim to have.

The caveat is a pattern, not a bug: **F-01 existed because a new module reimplemented an
authorization decision its siblings had already solved, and the test suite only ever built
ORGANIZATION-scoped actors, so the gap was invisible.** The same shape will recur in the
next HR module unless scope-boundary tests become routine. The fix moved the shared helper
to one place specifically to make the next module borrow rather than re-derive.

Recommended next: add a barrier-based concurrency test for payroll `lockRun` against
concurrent `decideOvertime`, and run the E2E and server suites before release.
