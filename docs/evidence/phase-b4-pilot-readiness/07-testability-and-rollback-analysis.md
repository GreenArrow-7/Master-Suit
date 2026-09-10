# 07 — Testability and rollback analysis

**Phase:** B4.0 · **Date:** 2026-09-08

No test is written here. This states what could realistically be tested and
what it would cost.

## Verification layers per candidate

| Candidate | UT | IT | E2E | ST | PT | REG |
|---|---|---|---|---|---|---|
| PC-01 | **yes** | no | optional | **yes** | no | **yes** |
| PC-02 | partial | no | **yes** | no | no | yes |
| PC-03 | **yes** | no | optional | no | no | yes |
| PC-04 | no | no | **yes**, and hard | no | no | no |
| PC-05 | **yes** (type-level) | no | no | no | no | yes |

## PC-01 in detail

**Unit.** The strongest case of the five, because the template already exists.
`tests/unit/csv.spec.ts` pins quoting, quote-doubling, comma containment,
formula neutralisation, the numeric exemption, ISO dates, the BOM and CRLF.
Extracting each page's row-building into a pure function makes those same
properties assertable per page with no browser.

**Security.** A dedicated `ST` asserting that a display name beginning `=`,
`+`, `-`, `@` or a tab is neutralised in each of the three exports. This is the
defect, so it is the test that matters.

**Regression.** A `REG` asserting no *fifth* local `csvCell` can reappear — the
same shape as the B2 suite's own `ST-002` allowlist scan. That directly answers
the library docblock's warning about a third copy drifting.

**Integration / E2E.** Not required. These are client components rendering data
already fetched; an e2e run would need a live application and prove less than
the unit tests.

**Test data.** Synthetic rows only. No production or staging data, no fixtures
containing real employee names.

**Mocks.** None needed if row-building is extracted as a pure function. If it
is not, a DOM harness is required — which is a reason to prefer the extraction.

**Environment.** `npm test` (vitest) only. No database, no browser, no network.

**Known untestable assumption.** How a given build of Excel or Sheets actually
renders a leading apostrophe. The guard is verified at the string level, which
is the correct boundary; spreadsheet behaviour is documented, not asserted.

## Rollback

| Question | PC-01 | PC-02 | PC-03 | PC-04 | PC-05 |
|---|---|---|---|---|---|
| Revertable by reverting code only? | **yes** | yes | yes | yes | yes |
| Mutates persistent data? | no | no | no | no | no |
| Requires schema change? | no | no | no | no | no |
| Creates data incompatible with the previous version? | no | no | no | no | no |
| Requires a feature flag? | no | no | no | no | no |
| Rollback requires a migration? | no | no | no | no | no |
| Could rollback lose data? | no | no | no | no | no |

**All five are CODE-ONLY ROLLBACK.**

For PC-01 specifically: an export is generated on demand and never stored. A
revert changes the next file produced and touches nothing already downloaded.
There is no state to unwind, and a previously exported file remains readable —
it is a CSV either way.

## The honest weak spot

**PC-04 is the least testable of the five.** Its symptom is browser-specific
and appears in a real browser under a real download. Proving the fix needs
Playwright against a running application, and proving the *defect* needs a
browser this phase never ran. A pilot could spend its whole budget establishing
whether there is anything to fix.

That is a strong argument against it as pilot #1 and is reflected in the
scoring.
