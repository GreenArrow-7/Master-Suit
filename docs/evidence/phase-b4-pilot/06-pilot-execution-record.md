# B4 pilot #1 — Execution record

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2`, re-confirmed against the final diff |
| Date | 2026-09-08 |
| Lifecycle state reached | `VERIFYING` |
| Recommended convergence verdict | `FAIL` — six findings `OPEN` pending human disposition |

Continues `docs/evidence/phase-b4-pilot/`. `01` recorded the stop; this records
what happened after the human answered.

---

## 1. Human decisions recorded

| Decision | Answer | Recorded in |
|---|---|---|
| `CL-001` — `Escape` behaviour | **option (c)** — descope; no new `Escape` behaviour | `clarifications.md` |
| `CL-002` — clear button | **option (a)** — none added | `clarifications.md` |
| Gate 1 specification approval | **APPROVED**, Product Owner, human | `spec.md`, `sdd.json` `approvals[0]` |

The approver's exclusion list is reproduced verbatim in `spec.md` and in the
`sdd.json` approval record, because it bounds every task.

**Withdrawn as one closed set by `CL-001`:** `FR-003`, `FR-004`, `AC-004`,
`E2E-004`, `TASK-002`, `AD-004`. All are struck through and annotated, **not
deleted** — the record shows what was considered and rejected.

**Added:** `FR-006`, stating positively what the decision requires — that no
new keyboard behaviour is introduced — so the decision is traceable rather than
merely an absence. Verified by inspection: zero matches for `onKey`, `keydown`,
`keyup`, `Escape` or `addEventListener` in the component.

`CL-002` required **no artefact change**: the specification already assumed no
clear button. The approver's conditional — preserve an existing clear control
if one exists — was checked against evidence and does not activate: `CL-R04`
established the component renders no button of any kind.

## 2. Lifecycle progression

`CLARIFYING` → `READY_FOR_PLAN` → `PLANNED` → `READY_FOR_APPROVAL` →
`APPROVED_FOR_IMPLEMENTATION` → `IMPLEMENTING` → `VERIFYING`

No state was skipped. Each transition is in `sdd.json` `statusHistory` with the
reason. The advance out of `CLARIFYING` was legitimate because its exit
criterion — no material ambiguity left `OPEN` — was actually met by the two
decisions, not asserted.

## 3. Risk re-confirmation

**`R2` holds.** Re-derived against the final diff, which is one presentational
component and one new Playwright spec. No `src/lib/auth/*`, no
`src/lib/security/*`, no permission, role, scope, RLS policy, session, MFA,
audit, PII or biometric surface (not `R4`). No API route, response shape,
service logic, queue job, integration client or migration (not `R3`). No
`infra/*`, workflow, secret or deployed environment variable (not `R5`).

## 4. Sessions

| Session | Role | Task | Result | Files changed | Scope-check |
|---|---|---|---|---|---|
| `ASES-0001` | `IMPLEMENTER` | `TASK-001` | `PASS` | `apps/web/src/components/workspace/TableSearch.tsx` | PASS — session 1, pre-existing 43, unattributed 14 |
| `ASES-0002` | `IMPLEMENTER` | `TASK-003` | `PASS` | `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | PASS — session 1, pre-existing 44, unattributed 14 |
| `ASES-0003` | `QA_REVIEWER` | `TASK-005` | `PASS` | none — execution records only | n/a |

Preflight passed before each. `TASK-002` was never opened.

**The 14 `UNATTRIBUTED` warnings are all untracked directories**, which cannot
be digested. That is the deliberate conservative behaviour introduced by the
B3 `CONV-007` remediation: flag for review rather than declare safe.

**Scope discipline is structural, not merely observed.** `TASK-001` declares
`apps/web/tests/` prohibited and `TASK-003` declares `apps/web/src/`
prohibited, so neither session could grade its own work.

## 5. Implementation

19 insertions, 3 deletions in one file — 10 of the insertions are comment.

- The status region is rendered **unconditionally**, so assistive technology
  observes it before its content changes (`ACC-003`).
- It carries **both** the count and the no-match message, so there is one
  announcement rather than two racing regions (`ACC-004`, `AD-003`).
- It uses the existing `.lf-visually-hidden` class, so nothing moves on screen
  (`NFR-003`).
- The two visible elements keep their positions and are `aria-hidden`, so the
  same text is not presented twice.
- The message string was extracted to a module constant rather than duplicated.

**`AD-006` — a declared deviation.** `AD-003` read literally would have moved
the visible message beside the search input, which `NFR-003` forbids. Two
approved statements conflicted; the conflict is recorded in `plan.md`, in
`REV-0001` and as `CONV-004`, and was resolved in favour of preserving
user-visible behaviour. It was **not** taken silently.

**No new dependency, no CSS, no `keydown` handler, no clear button, no
debounce, no abstraction.**

## 6. Tests

Seven Playwright cases in a new file. **No `Escape` test** — there is no
`Escape` behaviour, and asserting the absence of a handler would pass equally
against a deleted component. **No clear-button test** — no such control exists.

## 7. Verification actually run

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **PASS**, exit 0 |
| Lint | `npm run lint` | **PASS**, exit 0 — 0 errors, 122 pre-existing warnings, none in either changed file |
| Lint (new spec) | `npx eslint tests/e2e/tablesearch-a11y.spec.ts` | **PASS**, exit 0 |
| Format | `npx prettier --check` | **FAIL**, exit 1 — CRLF only. `CONV-001` |
| **E2E** | `npx playwright test tests/e2e/tablesearch-a11y.spec.ts` | **7 passed in 1.9m**, exit 0 |
| Unit suite | `npm test` | 1874 passed, **42 failed**, exit 1. `CONV-002` (12) + `CONV-003` (30) |
| Schema drift | `npm run check:drift` | **PASS** — no difference |
| B2 validator suite | `node tools/sdd/tests/validator.test.mjs` | **89 / 89 PASS** |
| B3 agent suite | `node tools/sdd/tests/agent.test.mjs` | **48 / 48 PASS** |
| Validator | `node tools/sdd/cli.mjs validate --all` | **PASS** — 0 errors, 0 warnings |

`npm run build` was not run: no route, layout or server code changed, and
`typecheck` covers the compile surface of a client component.
`check:rls` and `check:raw-sql` were not run: no tenant table and no raw SQL.

### Failure classification

| Failures | Classification | Basis |
|---|---|---|
| `prettier --check` | **ENVIRONMENT** | Byte-identical to prettier output after stripping `\r`; untouched `WorkspaceTable.tsx` fails identically |
| 12 vitest, 3 unit files | **PRE-EXISTING** | Exactly the files and counts `EVC-014` already registers |
| 30 vitest, 5 files | **ENVIRONMENT** | `master_saas_test` lacks `PasswordResetToken.platformUserId`; a different database from the one this pilot used |

**None is an implementation defect.** vitest sets no DOM environment, excludes
`tests/e2e/**`, and no vitest test imports `TableSearch` — so this change
provably cannot reach any of them.

## 8. E2E environment — how it was established

Predicted in `01` as likely `UNKNOWN`. It turned out to be runnable from the
repository's own documented local workflow.

| Step | Command | Note |
|---|---|---|
| Services | `npm run docker:up` | postgres, redis, minio, mailpit — **every port bound to `127.0.0.1`** |
| Schema | `npx prisma migrate status` | already current, 65 migrations. **Nothing created or applied** |
| Data | `ALLOW_DEMO_SEED=yes npm run db:seed` | the database had **0 users** |

**The seed's safety guard was used as documented, not edited.** It requires an
explicit confirmation that the target is disposable; that condition was
verified first — loopback container, database `leadflow`, zero users, started
minutes earlier.

**No production or staging system was contacted.** `DATABASE_URL`, `REDIS_URL`
and `S3_ENDPOINT` were confirmed to resolve to `127.0.0.1` **by hostname only**.
No secret value was read, printed or referenced at any point.

## 9. Browser accessibility verification, and its limits

**What was verified** — through the browser accessibility tree, in Chromium:
the `searchbox` role from native `type="search"`; the accessible name from the
visible `<label>`; the default name `Search` for a consumer passing none; the
live region present and empty before any query; the no-match message inside
that region; focus entering and leaving by `Tab` and `Shift+Tab`.

**What was NOT verified, and is not claimed:**

- **No real screen reader was exercised.** Whether NVDA, JAWS or VoiceOver
  announces this region in a given configuration is untested.
- **No WCAG conformance claim is made.** No axe or automated audit ran; none is
  installed and `NFR-001` forbids adding one.
- **Only Chromium.** The Playwright configuration defines one project. No claim
  about Firefox or WebKit.
- **No visual regression testing.** `NFR-003` is verified by `REG-002` and by
  reading the diff, not by pixel comparison.
- **The custom-label path was exercised, the six call sites were not.**
  `sales/people` was used; the other five render the same component.

## 10. Security screening of the final diff

No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `fetch`, `axios`, `prisma`,
`process.env`, `localStorage`, `sessionStorage`, `document.cookie` or
`window.location` anywhere in the diff.

**ARIA values are literals** — `aria-live="polite"`, `aria-hidden="true"`.
**No user-controlled value reaches any ARIA attribute.** The search query is
deliberately *not* interpolated into the live region; only row counts and a
module constant do.

No `.focus()` call, so no focus theft. No key handler, so no keyboard trap
introduced — and `E2E-001` proves focus enters and leaves in both directions.
No auth, authorization, tenant, PII, backend, API, database or secret surface.

**No risk escalation. `R2` stands.**

## 11. Review status

| Review | Actor | Decision | Satisfies human gate |
|---|---|---|---|
| `REV-0001` code review | **AI**, `QA_REVIEWER`, distinct actor | `APPROVE` | **NO** |

Nine findings: two `OBSERVATION`-level confirmations that the declared defects
are genuinely fixed, four further `OBSERVATION`s, and three `MINOR`.

**R2 requires one *human* code reviewer** — the row in
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` is titled "Human code review". `REV-0001`
does not satisfy it and does not claim to. This is `CONV-007`, and it is the
gate the pilot stops at.

## 12. Repository integrity

| Constraint | Status |
|---|---|
| Files changed | **2**, both authorised |
| Pre-existing 34 modified UI files | **untouched** — not stashed, reset, reverted or edited |
| `PC-01` CSV code | not touched |
| `EVC-016` | still `OPEN`, unmodified |
| Dependencies / lockfile | unchanged |
| Prisma schema / migrations | unchanged; none created |
| Auth / authorization / tenant | unchanged |
| CI | unchanged |
| Staging / production | **not accessed** |
| Deploy / push / commit / merge / tag | **none** |
| Staged files | **0** |
| `HEAD` | `f16ed677516fb07f31832a5d725e13efb477c34d`, unchanged |

## 13. Remaining human gates

| Gate | Status |
|---|---|
| Gate 1 — specification approval | **SATISFIED**, 2026-09-08 |
| **Human code review** (R2: 1 reviewer) | **REQUIRED — outstanding** (`CONV-007`) |
| Gate 6 — convergence acceptance | **REQUIRED — outstanding**; five findings need disposition |
| Gate 7 — production release | not reached, and out of scope |

**Single next human action:** review the two-file diff and disposition the six
open convergence findings.
