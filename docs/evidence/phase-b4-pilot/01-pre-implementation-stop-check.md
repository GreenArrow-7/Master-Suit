# Phase B4.1 — Pre-implementation stop check

| Field | Value |
|---|---|
| Specification | `SPEC-0003` — TableSearch keyboard and screen-reader accessibility |
| Pilot candidate | `PC-02` |
| Date | 2026-09-08 |
| Performed by | AI agent, Planner role |
| Outcome | **STOP — implementation is not authorised** |

This record exists because the Phase B4 brief requires that, before any
application code is touched, the lifecycle state, risk class, required gates,
preflight status, allowed and prohibited files and the git baseline are
recorded explicitly. It is written *before* any implementation attempt, and no
implementation attempt followed it.

---

## 1. Current specification lifecycle state

`READY_FOR_APPROVAL`, as recorded in `spec.md` and `sdd.json` at the time of
this check.

**This state is not correctly earned, and is corrected below.**
`docs/sdd/SPEC_LIFECYCLE.md` gives the entry criteria for
`READY_FOR_APPROVAL` as, verbatim:

> *Entry criteria:* traceability shows no requirement without a task, no
> requirement without a test, and no security requirement without a security
> verification. **Open questions that are material are closed.**

`SPEC-0003` has two open questions that its own `clarifications.md` declares
**material** (`CL-001`, `CL-002`). The last criterion is therefore not met.
The honest lifecycle position is `CLARIFYING`, whose exit criterion is "No
material ambiguity is left OPEN".

`tools/sdd/lib/lifecycle.mjs` permits the transition
`READY_FOR_APPROVAL` to `CLARIFYING`. The status has been corrected
accordingly. This is a downgrade, not an advance: it makes the block more
explicit and cannot be read as progress.

## 2. Risk class, re-confirmed against the actual change surface

**`R2`. Unchanged.**

The B4.0 classification was made against a described candidate. This check
re-derives it from the concrete diff surface the plan now names — one
component file and one new Playwright spec — using
`docs/RISK_CLASSIFICATION.md`.

| Level | Trigger present in this change? | Evidence |
|---|---|---|
| `R5` | **No** | No `infra/*`, no `.github/workflows/*`, no `scripts/release.sh`, no backup or restore script, no secret rotation, no deployed environment variable, no host, IAM, DNS, TLS or firewall change, nothing run against production |
| `R4` | **No** | No `src/lib/auth/*`, no `src/lib/security/*`, no permission, role or scope, no visibility or field rule, no RLS policy, no session or MFA behaviour, no audit logging, no PII or biometric handling, no AI prompt or redaction change, no retention period, no new outbound data flow |
| `R3` | **No** | No `/api/v1` route, no changed response shape, no service logic, no queue job, no integration client, no Prisma migration |
| `R2` | **Yes** | A non-security defect fix in a presentational component, plus new tests — the `R2` row names exactly "a non-security bug fix in a service" and "a new unit test" |
| `R1` | Exceeded | The change adds behaviour and test coverage; it is not a copy edit or a styling tweak |

Classification is by the **highest** level any part of the change touches. The
highest trigger present is `R2`.

Neither escalation note in `docs/RISK_CLASSIFICATION.md` applies: the change
adds no environment variable to a deployed environment, and it is not
documentation asserting a new security or operational guarantee.

## 3. Required gates at R2, derived mechanically

From the "Required gates" table in `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
reading the `R2` column, cross-checked against
`docs/sdd/HUMAN_APPROVAL_GATES.md`.

| Gate | R2 requirement | Satisfied? | Note |
|---|---|---|---|
| Spec approval | author | **NO** | See section 4 |
| Architecture approval | — | **NOT REQUIRED** | No new pattern introduced |
| Security review | self-check | **YES** | No security surface; recorded in `spec.md` and `plan.md` |
| Separate implementation-readiness approval | — | **NOT REQUIRED** | Gate 5: "At R0-R2 the author proceeds once the artefacts the risk matrix requires exist" |
| Human code review | 1 reviewer | **PENDING** | Falls due after implementation, not before. `TASK-005` requires a `REV-` record with `actorType` `human` |
| CI gates | full `verify` | **PENDING** | Falls due at verification |
| Convergence verdict accepted by | author | **PENDING** | Falls due at convergence |
| Production release approval | normal release | **OUT OF SCOPE** | No release is in scope for this phase |
| Agent may execute | yes | **YES** | R2 permits local agent execution |

**No approval gate blocks implementation at R2 by itself.** Gate 5 is explicit
that at R0-R2 no separate implementation-readiness approval exists. That is
not, however, the only rule that governs whether implementation may begin.

## 4. Gate 1 — specification approval, unresolved

The `R2` row names the **author** as the approver. The author of `SPEC-0003`
is an AI agent.

`AGENTS.md` forbids an agent granting itself an approval or treating its own
confidence as a gate passed. An AI author therefore cannot discharge an
author-approval gate by being the author.

This is recorded in `spec.md` as **UNRESOLVED** and no approval record has
been written. `approvals` in `sdd.json` is empty.

**This is not a defect in the specification.** It is a structural consequence
of an AI authoring an R2 specification in a process whose R2 row assumes a
human author. It needs a human decision, offered in the decision packet as
either approving the specification or adopting authorship of it.

## 5. The blocking condition — open material clarifications

Three governing documents state the same rule independently. None is
ambiguous, and none is qualified by which task the clarification affects.

**`docs/sdd/CHANGE_WORKFLOW.md`, STOP conditions, item 1:**

> A material requirement is unresolved or a material clarification is OPEN.

**`AGENTS.md`:**

> **Stop before implementing** when a mandatory artefact or approval for the
> risk level is missing, **when a material clarification is open**, or when any
> STOP condition in `docs/sdd/CHANGE_WORKFLOW.md` holds. Report the block and
> the single next action; do not proceed on an assumed approval.

**`docs/sdd/SPEC_LIFECYCLE.md`, the governing rule, with the entry criteria
for `APPROVED_FOR_IMPLEMENTATION`:**

> Material implementation must not begin until the specification has reached
> the approval state required by its risk level.

Entry requires, among others, that **material clarifications are resolved**.

`SPEC-0003` has two:

| Clarification | Question | Status | Materiality |
|---|---|---|---|
| `CL-001` | What should `Escape` do? | `OPEN` | Determines whether `FR-003`, `FR-004`, `AC-004`, `E2E-004` and `TASK-002` survive at all |
| `CL-002` | Should a visible clear button be added? | `OPEN` | Determines whether the scope stays where it is |

Both are UX policy. Neither is answerable from repository evidence — which is
precisely why the seven questions that *were* answerable were resolved from
evidence as `CL-R01` to `CL-R07`, and only these two were left open.

### The narrower reading, and why it was rejected

`TASK-001` (render the status region unconditionally and move the no-match
message inside it) is **not individually blocked** by `CL-001`, which gates
only `TASK-002`. A narrower reading would permit implementing `TASK-001` now.

That reading was rejected. The rule as written is a property of the
specification, not of the task: "a material clarification is OPEN", not "a
material clarification affecting this task is open". Reading a task-level
qualifier into a specification-level rule, in order to unblock myself, at the
one point where the rule bites, is the failure mode the phase brief names
explicitly:

> Never solve a blocker by: weakening a rule; creating an exception simply for
> convenience; ... widening scope retrospectively.

The same reasoning rules out a second tempting move: amending `SPEC-0003` to
descope `Escape`, which would dissolve `CL-001` and leave `TASK-001`
implementable. Descoping may well be the right engineering answer, and it is
offered as an option in the decision packet — but it is a scope decision, and
an agent taking it unilaterally to unblock itself is the same defect wearing
different clothes. It is offered to the human, not taken.

## 6. Preflight status

**Not run, and deliberately so.** `agent preflight` authorises a session to
begin work on a task. Running it before establishing that implementation is
permitted would invert the order of the check and leave a session record
implying an authorisation that does not exist.

No `ASES-` session was opened. No task moved to `IN_PROGRESS`.

## 7. Allowed and prohibited files, had implementation proceeded

Recorded for the human who will authorise the next attempt, from `tasks.md`.

**`TASK-001` allowed:** `apps/web/src/components/workspace/TableSearch.tsx`
**`TASK-001` prohibited:** `apps/web/src/app/`,
`apps/web/src/components/ui/`, `apps/web/package.json`, `apps/web/tests/`

**`TASK-003` allowed:** a new Playwright spec under `apps/web/tests/e2e/`,
named `tablesearch-a11y`
**`TASK-003` prohibited:** `apps/web/src/`, `apps/web/package.json`, and the
Playwright and Vitest configuration files

The two sets are disjoint by construction, so the task that writes the tests
cannot edit the component under test, and the task that edits the component
cannot edit its tests.

## 8. Git and digest baseline

| Field | Value |
|---|---|
| Branch | `dev/yourhan-next` |
| `HEAD` | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Working tree | 34 modified tracked files, plus untracked paths, **all pre-existing** |
| `TableSearch.tsx` | **not modified** relative to `HEAD` |
| `TableSearch.tsx` SHA-256 | `e6d5f483a14aa41be532cc9a1194b7fe8b1669af944ed9dce39843fecb67a594` |
| `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | **does not exist** |

The pre-existing modifications are the human's in-flight redesign work. They
were **not** stashed, reset, reverted or edited. The target component is clean
at `HEAD`, so a future session touching it attributes cleanly as `SESSION`
rather than `UNATTRIBUTED`.

## 9. Verification environment, assessed but not exercised

Checked to determine what a verification run *could* have claimed, so the
finding is recorded now rather than discovered later.

| Prerequisite | State |
|---|---|
| `@playwright/test` | present, `^1.51.1` |
| Playwright browsers | installed — `chromium-1234`, `chromium_headless_shell-1234`, `ffmpeg-1011` |
| `node_modules` | present |
| `.env` | present. **No value was read, printed or referenced** |
| Docker engine | available |
| Docker PostgreSQL container | **not running — no container is up** |
| Application | not running |

The Playwright harness needs a running application and a seeded database, and
executes with `workers: 1` against one shared database.

**Had implementation proceeded, the E2E result would have been recordable only
as `UNKNOWN — requires runtime/infrastructure verification`, never as `PASS`.**
No suite was run and no result is claimed either way.

## 10. Outcome

**STOP. Implementation of `SPEC-0003` is not authorised.**

The block is *not* an approval gate — `R2` requires no separate
implementation-readiness approval, and that was checked first. The block is
the open material clarifications, under a rule stated identically in
`CHANGE_WORKFLOW.md`, `AGENTS.md` and `SPEC_LIFECYCLE.md`.

Two human decisions are needed, and both fit in one sitting:

1. **Product Owner** — answer `CL-001` and `CL-002`.
2. **A human** — approve `SPEC-0003` at gate 1, or adopt authorship of it.

Both are prepared in
`docs/evidence/phase-b4-pilot/02-decision-packet-spec-0003.md`. Neither is
decided here.

**Single next action for a human:** read that packet and answer the two
clarifications.
