# A request body may carry 20,000 list entries, and the audit gate names what it allows

**What.** `route()` counts the array elements in a JSON body and refuses it at
20,000 before any schema runs. `npm audit` in CI becomes
`scripts/audit-gate.mjs`: the same high-and-above threshold, plus named
exceptions that carry their mitigation and expire on a date. nodemailer moves to
10.3.1.

**Why.** CI went red on every PR (#238, #239, #240) on the `Audit` step:
GHSA-mrhx-c7xc-m3w5, high, "Zod can exhaust memory while validating oversized
constrained collections". It is real here, and measured: `z.array(z.string())`
against 200,000 wrong values keeps 200,000 issue objects and +86 MB of heap,
linear and uncapped. A schema's own `.max()` does not save it — zod records the
length issue *and* still parses every element (200,001 issues, +94 MB, measured).
With bodies buffered to 10 MiB, a signed-in caller could reach a few million
elements, which is gigabytes in one shared process.

zod patched it in 4.6.6 only. 3.25.76 is the end of the 3.x line, so there is
nothing to upgrade to short of zod 4, which restructures the internals
`src/lib/api/openapi.ts` reads, across 245 files. That upgrade is worth doing
deliberately, not at the point of a red build.

So the cost is bounded where it is actually incurred: in the one function every
route's body passes through. The largest array any route accepts is 4,000, and
the spreadsheet imports cap at 1,000 rows, so 20,000 is five times the real
ceiling and covers the 47 route files whose arrays carry no `.max()` at all.

**Where**

- `apps/web/src/lib/api/handler.ts` — `assertArraysAreSane`, called from
  `readJsonBody` after `JSON.parse`; an explicit stack, not recursion, because
  the depth of the input is the caller's.
- `apps/web/scripts/audit-gate.mjs` — the gate, with the zod exception recorded
  until 2026-12-15.
- `.github/workflows/ci.yml` — the `Audit` step runs it.
- `apps/web/package.json`, `package-lock.json` — nodemailer `^10.3.1`.

**Behaviour.** A body over the ceiling answers 422 `too-many-items` with "Send
it in smaller batches"; nothing else changes, and no legitimate request comes
near it. A 1,001-row import still meets the import's own `.max(1000)`, not the
guard. The three nodemailer advisories (a nested comment, a `;` in a quoted
string and a `>` in a quoted local part each ending an address early, so mail
could go to a domain the header does not name) are gone.

**Verified.** Two new cases in `tests/sales/idempotency-key.spec.ts`: 20,001
rows answer 422 `too-many-items` and write no lead; 1,001 rows answer 422
*without* it. `tsc` clean, prettier clean. The gate was proved to fail the two
ways that matter — an expired exception blocks, and an unlisted high advisory
blocks — by moving the date and the id and watching each one exit 1. `npm audit
--omit=dev` now reports one high (allowed, in date) and one moderate
(`fast-uri`, below the threshold, and absent from the production tree).

**Also here.** `changes/PROJECT.md`'s header said "Updated 2026-10-11 …
f9c0c1a … 101 migrations" for three weeks after it stopped being true, and
#241 was cut from that commit on the strength of it — 11 Oct code in front of
a database holding 25 later migrations. It now carries the verified figures
(`4861a72f83e320c00973f654043aa709e84813e1`, 126 migrations, both image
digests, the preflight's count, 18/18 smoke) and asks for the same in the
change that releases the next one.

**Also here.** The browser suite reached 199 tests and stopped fitting its
35-minute step budget: run 41844625940 was cut 25 seconds after test 197
passed, nothing failed, the server still answering in 168 ms. The step takes 45
and the job 75.

**Left open.** The zod 4 upgrade, before 2026-12-15, when the exception expires
and the build fails again on purpose. `fast-uri` clears itself whenever `ajv`
ships a release that takes 3.1.9.
