# B4 pilot #1 — final consolidated decision packet

| Field | Value |
|---|---|
| Specification | `SPEC-0003` — TableSearch accessibility |
| Risk | `R2` |
| Lifecycle | `VERIFYING` |
| Verdict | `FAIL` — seven findings `OPEN`, all awaiting a human |
| Prepared | 2026-09-08 by AI agent |
| Decisions | **7**, one sitting |

**Every remaining blocker is a human decision.** No engineering work is
outstanding on `SPEC-0003` itself. Nothing below is decided here.

Roles are taken from `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 9, which sorts
accepted residual risk into three categories: **security** → Application
Security, **functional or scope** → Product Owner, **operational** → DevOps /
Production Engineering.

---

## The product change under decision

Two files. `apps/web/src/components/workspace/TableSearch.tsx` (+19/−3, ten of
them comment) and `apps/web/tests/e2e/tablesearch-a11y.spec.ts` (new, 7 cases).

**Evidence:** Playwright 7/7 · typecheck clean · lint clean · scope-check
`session 1` on each session · no dependency, schema, auth, authorization,
tenant, API or database surface touched · all ARIA values literal, no
user-controlled value in any ARIA attribute.

---

# D-B4-01 — CONV-005 · live-region announcement behaviour

**Role: Product Owner.** Functional behaviour.

**Question.** The status region is `aria-live="polite"` and its content changes
as the user types; at zero matches it appends *"Nothing on this page matches.
Clear the box to see every row again."* Is that the intended product behaviour
for `SPEC-0003`?

**Evidence.** Before this pilot the message was announced **never** — it sat
outside any live region. Making it audible is the fix `ACC-004` asked for. The
frequency is inherited from the pre-existing per-keystroke count, which
`FR-005` requires to stay as it is. No requirement is violated. `E2E-005`
proves the region exists before its content and carries the message.

| | Option | Consequence |
|---|---|---|
| **A** | **Accept current behaviour** as the intended contract | **No code change.** `CONV-005` → `RESOLVED` |
| **B** | Announce only on entry to / exit from the empty state | Spec, code and test change; `SPEC-0003` → `IMPLEMENTING` |
| **C** | A different announcement contract | Spec amended first, then code |
| **D** | Reject the accessibility design | Remediation; pilot stays open |

**Engineering consequence.** A is the only option that closes the pilot without
reopening implementation. B, C and D each need a change record, a bounded task,
a session and a Playwright re-run.

**Not recommended either way — this is a taste judgement about what a
screen-reader user should hear, and no browser test can settle it.**

---

# D-B4-02 — CONV-007 · human code review

**Role: any competent human reviewer.** `R2` requires **1 reviewer**
(`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, row *Human code review*).

**This gate cannot be satisfied by an AI and no acceptance substitutes for it.**
`REV-0001` exists, returned `APPROVE`, and carries `actorType: "ai"` with
`satisfiesHumanGate: false`.

**Question.** Reviewing the two files above: `APPROVE`, `REQUEST_CHANGES`, or
`BLOCKED`?

**What to look at.** Full packet at `08-human-code-review-packet.md`. The one
judgement call is **`AD-006`**: `AD-003` as approved would have moved the
visible message beside the search input, which `NFR-003` forbids. The
implementation instead uses one visually-hidden live region carrying both
texts, with the two visible elements `aria-hidden`. Two approved statements
conflicted and the conflict is recorded, not papered over. **Please confirm or
reject that.**

**Consequence.** `APPROVE` → `CONV-007` `RESOLVED`. `REQUEST_CHANGES` →
`SPEC-0003` returns to `IMPLEMENTING` under a change record.

---

# D-B4-03 — CONV-001 · Prettier / CRLF

**Role: DevOps / Production Engineering.** Operational limitation under gate 9.
*(If read as release readiness instead, QA / Release Engineering — please sign
whichever you consider correct.)*

**Question.** Accept the Prettier mismatch as an environmental, pre-existing
formatting limitation for pilot #1?

**Evidence.**
- After stripping `\r`, the file is **byte-identical** to Prettier's output.
- `git config core.autocrlf` is `true`.
- The **untouched** `WorkspaceTable.tsx` fails the identical check.
- No behavioural defect is attributed to it; Playwright is 7/7.

| | Option | Consequence |
|---|---|---|
| **A** | `ACCEPT_RISK` for pilot #1 | `CONV-001` → `ACCEPTED_RISK`. **No source formatting changed during this pilot.** Backlog: a repository line-ending normalisation policy |
| **B** | `REQUIRE_REMEDIATION` | Pilot stays open until the policy lands |

**Line endings were deliberately not normalised.** `prettier --write` would
rewrite files this pilot does not own, turning a cosmetic local failure into a
large spurious diff in the human's in-flight work.

---

# D-B4-04 — CONV-003 · test-database workflow

**Role: DevOps / Production Engineering.** Operational limitation.

**Question.** Accept for pilot #1, with a documented bootstrap **required
before pilot #2**?

**Evidence — the schema defect is already remediated.** `master_saas_test` was
one migration behind (`20260904080000_platform_scoped_password_reset`, adding
`PasswordResetToken.platformUserId`). That existing migration was applied
locally: **1874 pass / 42 fail → 1892 pass / 24 fail.** No migration created,
no schema modified, no reset, loopback only.

**What remains** is that no deterministic workflow creates or prepares that
database. `generate-secrets.mjs` states it is created by `npm run setup`; it is
not — `setup` migrates `leadflow`, and compose creates only `leadflow`.

**`SPEC-0003` verification does not depend on any of those tests.** Its
evidence is Playwright against `leadflow`, plus typecheck and lint.

| | Option | Consequence |
|---|---|---|
| **A** | `ACCEPT_RISK` for pilot #1 + **REQUIRED before pilot #2** | `CONV-003` → `ACCEPTED_RISK` with a named follow-up |
| **B** | `REQUIRE_REMEDIATION` now | Test infrastructure work before the pilot closes |

Four implementation options, and the two orphaned migrations question, are in
`11-test-database-bootstrap.md`. **Not redesigned during closure.**

---

# D-B4-05 — CONV-010 · historical `ASES-0008` scope deviation

**Role:** gate 9 assigns *scope* limitations to the **Product Owner**; this is
session scope rather than product scope, so **QA / Release Engineering** may be
the better fit. **Please confirm which role signs.**

**Question.** Accept the historical deviation as a non-precedential limitation?

**Evidence.** `SPEC-0002/ASES-0008` edited that specification's `test-plan.md`
and `change-record.md`; `TASK-018` declared neither. Both edits were legitimate
work — registering the ten tests the task was told to write, and amending the
change record before implementation.

- **No retroactive widening.** `TASK-018`'s scope was not edited to cover them.
- Preserved: the original declaration, the session's recorded paths, its
  `PARTIAL` result, and the disclosure in `VER-0008` and `REV-0010`.
- **The model has since been fixed.** `TASK-021` added a closed meta-artefact
  allowance, so `change-record.md` is now lawful — but **`test-plan.md` is
  deliberately excluded**, so that half remains a genuine deviation.

| | Option | Consequence |
|---|---|---|
| **A** | `ACCEPT_RISK`, historical and non-precedential | `CONV-010` → `ACCEPTED_RISK`. Future sessions stay bound by current controls |
| **B** | `REQUIRE_REMEDIATION` | There is nothing to remediate without rewriting history, which is forbidden |

---

# D-B4-06 — CONV-011 · unrelated product-suite failures

**Role: QA / Release Engineering.** Test adequacy.

**Question.** Accept 12 failures as a pre-existing baseline limitation
unrelated to `SPEC-0003`?

**Evidence — classification only, no repairs attempted.**

| Check | Result |
|---|---|
| Do they import `TableSearch`? | **No** — zero references in either file |
| Do they reference `components/workspace`? | **No** — zero |
| Do they exercise the new spec file? | **No** — vitest excludes `tests/e2e/**` |
| What do they actually read? | the AI assistant tool and service modules, plus the events API route |
| Could `SPEC-0003` have caused them? | **No** — it changed two files, neither of which those suites touch, and vitest sets no DOM environment |

The assertions are static analysis of source text — *"searchLeads reads
`prisma.account` but neither requires it nor is listed in ALLOWED"* — describing
drift between the AI assistant's declared tool permissions and the models its
tools read.

| | Option | Consequence |
|---|---|---|
| **A** | `ACCEPT_RISK` as pre-existing, backlog separately | `CONV-011` → `ACCEPTED_RISK` |
| **B** | `REQUIRE_REMEDIATION` | Product work in `src/lib/ai/`, plausibly `R4` since it concerns what an AI tool may read — its own specification |

---

# D-B4-07 — CONV-012 · Playwright flake

**Role: QA / Release Engineering.** Test-harness stability.

**Question.** Accept the observed intermittent failure for pilot #1?

**Evidence.** One run failed in `beforeAll` on unchanged code:
`getByLabel('Authentication code')` not found in `loginPlatformOwner`, with the
platform owner showing `mfaEnabled: false` and a `404` on the login route.
Recorded rather than discarded because `playwright.config.ts` sets `retries: 0`
precisely so flakes stay visible.

**Three-run characterisation — results in section 13 of the closure report.**

| | Option | Consequence |
|---|---|---|
| **A** | `ACCEPT_RISK`, backlog the harness flake | `CONV-012` → `ACCEPTED_RISK` — **only if all three runs passed** |
| **B** | `REQUIRE_REMEDIATION` | `ensureOwnerAuthenticator` investigated before the pilot closes |

**If any of the three runs failed, option A is not available** and `CONV-012`
stays `OPEN` with the new evidence.

---

## Convergence after these decisions

| All accepted / approved | Any `REQUIRE_REMEDIATION` |
|---|---|
| `OPEN` = 0 · `RESOLVED` = 7 · `ACCEPTED_RISK` = 5 | `OPEN` > 0 |
| Verdict → **`PASS WITH ACCEPTED LIMITATIONS`** | Verdict stays **`FAIL`** |
| Then: **final human convergence acceptance** | `SPEC-0003` → `IMPLEMENTING` |

`RESOLVED` would be `CONV-002`, `-004`, `-006`, `-008`, `-009` (already), plus
`CONV-005` (option A) and `CONV-007` (`APPROVE`).
`ACCEPTED_RISK` would be `CONV-001`, `-003`, `-010`, `-011`, `-012`.

**An accepted risk is never recorded as `RESOLVED`.**

## What is not being asked

No decision here authorises a deploy, a push, a commit, a merge, a migration,
pilot #2, `PC-01`, or any resolution of `EVC-016`.
