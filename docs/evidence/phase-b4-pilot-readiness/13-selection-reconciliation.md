# 13 — Pilot-selection reconciliation

**Phase:** B4.0 · **Date:** 2026-09-08
**Supersedes** the recommendation in `09` and `10`. Those documents are not
deleted; this one records what changed and why.

---

# Audit 1 — PC-01 risk classification

## Result: AMBIGUOUS. Not resolvable from the authoritative artefacts.

**`PC-01` is therefore NOT eligible as the first pilot**, pending a human
classification decision. Registered as **`EVC-016`**.

## The exact governance language

**`docs/RISK_CLASSIFICATION.md`, R4 row** — verbatim:

> Security / data-sensitive — anything in `src/lib/auth/*` or
> `src/lib/security/*`, permissions/roles/scopes, visibility or field rules,
> RLS policies, session or MFA behaviour, audit logging, **PII/biometric
> handling**, AI prompt or redaction changes, retention periods, new outbound
> data flows

Read literally, "PII handling" carries no qualifier. Re-encoding employee names
into a CSV is handling PII, so `PC-01` is R4.

**`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, escalation triggers** — verbatim:

> Retention, audit or **biometric** handling changes.

The escalation list names biometric handling and **omits PII entirely**.

**`docs/security/SECURITY_MODEL.md`, sensitive data categories** — treats
"PII (names, phones, e-mails, addresses …)" and "biometric templates and
images" as **two separate categories**. The R4 row merges them with a slash.

**`AGENTS.md`** — mentions personal data only in the logging prohibition
(§3, "no … personal data in logs") and in "A change that weakens one [isolation
layer] is R4 at minimum". Neither reaches export formatting.

**`CLAUDE.md`** — lists PII among the security implications a plan must state.
Does not classify.

## The distinction nothing draws

| | Kind of change | `PC-01`? |
|---|---|---|
| **A** | Access control or authorization over PII | **no** — `assertPermission` and `visibilityWhere` untouched; both live on the server route, and all four drifted copies are client components |
| **B** | New collection or new disclosure of PII | **no** — no column added, no row added, no new outbound flow, no new recipient |
| **C** | Transformation or export *formatting* of PII the caller is already authorised to read | **yes — this is exactly `PC-01`** |

Whether **C** is an R4 trigger is not determinable. Searched across
`RISK_CLASSIFICATION.md`, `RISK_TO_PROCESS_MATRIX.md`, `SECURITY_MODEL.md`,
`AGENTS.md` and `CLAUDE.md` for "already authorised", "formatting",
"re-encoding", "encoding of" — **no match anywhere**.

## Why R3 was not chosen

The B4.0 instruction is explicit: where authoritative language is ambiguous, do
not choose R3. My earlier `06` argued a reading and landed on R3 with a flag.
That was a judgement call presented as a classification, and it is withdrawn.

`06` remains on record as the reasoning that was offered; this document records
that the reasoning was not sufficient to settle the class.

## Required human decision

The owner of `docs/RISK_CLASSIFICATION.md` — Solution Architect, with
Application Security consulted — decides whether category **C** is an R4
trigger, and qualifies the R4 row so the question does not recur.

---

# Corrected CSV-injection evidence classification

The previous wording said the payload **"executes in Excel"**. That is a
stronger claim than the evidence supports and is withdrawn.

## Corrected wording

> Formula-leading CSV cells may be interpreted as formulas by spreadsheet
> software. The repository's hardened CSV encoder (`src/lib/csv.ts`) explicitly
> guards against this class of spreadsheet-formula injection; the four
> client-side copies do not.

## Evidence levels, split by claim

| Claim | Level | Basis |
|---|---|---|
| The four local `csvCell` copies lack the formula guard | **VERIFIED** | Four files read; the guard regex is absent from each |
| `src/lib/csv.ts` implements a formula guard with a numeric exemption | **VERIFIED** | Code read; `tests/unit/csv.spec.ts` asserts it |
| Formula-leading cells are a recognised spreadsheet-injection class | **DOCUMENTED** | The library's own docblock and test names state it; it is an industry-recognised class |
| A specific payload would execute in a specific spreadsheet build | **UNKNOWN** | **No spreadsheet runtime test exists, and B4.0 ran none.** Not verified, not tested |

**Overall classification of the vulnerability: `DOCUMENTED`.** The absence of
the guard is verified; the exploitation is documented as a class and has not
been demonstrated here.

---

# Audit 2 — PC-02 test-harness readiness

## Result: EXISTING TOOLING SUFFICIENT

**No dependency needs to be added.** Nothing was installed.

## What the repository already has

| Tool | Version | Present |
|---|---|---|
| `@playwright/test` | ^1.51.1 | **yes**, devDependency |
| `vitest` | 4.1.10 | **yes**, devDependency |
| 16 Playwright e2e specs | — | `apps/web/tests/e2e/` |
| `playwright.config.ts` | — | configured, `workers: 1`, globalTeardown |

## What is absent

`jsdom`, `happy-dom`, `@testing-library/react`, `@testing-library/user-event`,
`@axe-core/playwright`, `jest`, `cypress` — **none present**, in either
dependency block.

`vitest.config.ts` sets no `environment`, so it defaults to `node`. **There is
no DOM in the unit layer.**

## What can be verified with what exists

| Requirement | Verifiable? | How |
|---|---|---|
| Keyboard operation | **yes** | Playwright `page.keyboard.press('Escape')` |
| Focus behaviour | **yes** | Playwright `expect(locator).toBeFocused()` |
| Accessible name / role | **yes**, and already the house style | `getByRole('searchbox', { name: 'Search' })` — `getByRole` is used throughout the existing suite |
| Screen-reader-relevant ARIA semantics | **yes**, structurally | role and accessible-name assertions, plus asserting the live region exists and updates |
| Regression of current `TableSearch` behaviour | **yes** | drive the input, assert row visibility and the "N of M shown" count |

## The cost, stated plainly

Verification for `PC-02` is **E2E-only**. Component-level unit testing of a
React client component is **not possible** without adding `jsdom` and React
Testing Library, which B4.0 forbids.

That means the pilot's test loop needs `.env`, the local Docker Postgres, a
running application, seeded data, and serial execution — the suite runs
`workers: 1` because every spec drives one shared database.

Two honest consequences:

1. It is a **materially heavier loop** than `PC-01` would have had, since
   `PC-01` was unit-testable with no browser, database or network.
2. Automated accessibility auditing (axe) is unavailable. Assertions will be
   explicit and structural — role, name, focus, live region — not a general
   a11y sweep. That is narrower, and it is what the tooling supports.

Neither is a blocker. Both are real costs the selecting human should see.

---

# Updated ranking

| Rank | Candidate | Class | Eligible as pilot #1 | Note |
|---|---|---|---|---|
| **1** | **PC-02** — `TableSearch` keyboard and screen-reader | **R2** | **yes** | Existing tooling sufficient; E2E-only verification |
| 2 | PC-03 — `Pager` `rel` attributes | R2 | yes | Same harness; very small |
| 3 | PC-04 — `ExportCsv` blob lifetime | R2 | yes | Defect unobserved; weakest verification story |
| 4 | PC-05 — dead `EmptyState` prop | R1 | yes | Too trivial to exercise the controls |
| — | **PC-01** — CSV encoder consolidation | **UNRESOLVED** | **NO** | Blocked by `EVC-016` |

`PC-01` remains the most valuable candidate on the merits. It is ineligible for
sequencing reasons, not because the work is wrong, and it should return once
`EVC-016` is decided.

## Recommended first pilot: PC-02

Following the reconciliation rule: `PC-02` is R2, existing tooling is
sufficient, and no other material blocker was found in the repository.

**A recommendation, not a selection.**

### Why it holds up

Real accessibility value across 6 call sites. The no-match message currently
sits outside any live region, so a screen-reader user hears the count change
but never the message; there is no Escape-to-clear. Both are verifiable with
the Playwright harness already in the repository, using the `getByRole` style
the suite already uses.

R2 needs a lighter gate set than R3 — author-level specification approval, one
reviewer — which is a reasonable shape for a first pilot that is proving the
machinery rather than stress-testing it.

### What it does not do

It does not exercise the R3 gates: specification approval by a Product Owner or
Solution Architect, and `SDD-V059`/`SDD-V060` demanding a *timely* approval.
Those rules were built in B3 and remain unexercised on real product work. That
is a genuine loss relative to `PC-01`, and it is the reason `EVC-016` is worth
deciding rather than routing around.
