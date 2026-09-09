# SPEC-0009 — Plan

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |

## Approach

Three advisories, three different remedies, deliberately not one command. Two of
the three need no `apps/web/package.json` change at all, which is only visible once the
declared ranges and the existing `overrides` block are read.

## Measured baseline, 2026-09-09

| Package | Declared | Installed | Direct? | Vulnerable range | Fixed at |
|---|---|---|---|---|---|
| `next` | `16.2.12` (exact pin) | 16.2.12 | yes | `>=16.0.0 <16.3.3` | **16.3.3** |
| `nodemailer` | `^9.0.4` | 9.0.4 | yes | high `<9.1.0`; moderates `<=9.1.0` | **9.1.1** |
| `sharp` | via `overrides: ^0.35.0` | 0.35.3 | **no** — optional dep of `next` | `<0.35.4` | **0.35.4** |

`npm audit --omit=dev`: 1 critical, 2 high, 3 total.

## Architecture decisions

- `AD-001` — **`next` to 16.3.4, not 16.3.3.** 16.3.3 clears the two critical
  advisories but declares `sharp: ^0.35.3`, readmitting the vulnerable `sharp`.
  16.3.4 declares `^0.35.4`. See `CL-001`.

- `AD-002` — **`nodemailer` by lockfile only.** `^9.0.4` already admits `9.1.1`.
  No `apps/web/package.json` edit. `9.1.1` rather than the minimum `9.1.0`, because it
  additionally clears two moderates at no cost.

- `AD-003` — **`sharp` by lockfile, with the override tightened.** The existing
  `overrides` entry already admits the fix, so `npm update sharp` moves it.
  Tightening `^0.35.0` to `^0.35.4` stops a future lockfile regeneration
  resolving backwards. See `CL-003`.

- `AD-004` — **`npm audit fix --force` is not used.** It proposed `next@16.3.4`,
  which happens to be right, and would have reached it by a route that also
  rewrites unrelated resolutions. The same version is taken deliberately, with
  the reason recorded, and the diff is bounded by `FR-005`.

- `AD-005` — **No suppression of any kind.** No ignore file, no `--audit-level`
  change, no override added to hide a package. `NFR-001` states it because it is
  the cheapest wrong answer available and it would pass CI.

- `AD-006` — **Windows-local evidence is not sufficient on its own.** The
  changed platform binaries here are `@next/swc-win32-x64-msvc` and
  `@img/sharp-win32-x64`; CI resolves the Linux equivalents. Local green is
  necessary, not sufficient; the lockfile carries both and `npm ci` is what
  proves it.

## Expected diff

**`apps/web/package.json`** — one mandatory line, one recommended:

```
- "next": "16.2.12"
+ "next": "16.3.4"

  "overrides": {
-   "sharp": "^0.35.0"
+   "sharp": "^0.35.4"
  }
```

`nodemailer` is untouched.

**`apps/web/package-lock.json`** — measured by dry run, nothing written:

| Package | From | To |
|---|---|---|
| `next` | 16.2.12 | 16.3.4 |
| `@next/env` | 16.2.12 | 16.3.4 |
| `@next/swc-<platform>` | 16.2.12 | 16.3.4 |
| `@swc/helpers` | 0.5.15 | 0.5.23 |
| `nodemailer` | 9.0.4 | 9.1.1 |
| `sharp` | 0.35.3 | 0.35.4 |
| `@img/sharp-<platform>` | 0.35.3 | 0.35.4 |

**7 changed, 0 added, 0 removed.** Anything materially wider is `FR-005`
failing and stops the work.

## Compatibility assessment

| Surface | Assessment |
|---|---|
| React peer range | `^19.0.0`; installed 19.2.8. Unchanged between 16.2 and 16.3 |
| `eslint-config-next` | already `^16.3.0` — the dev tooling expects 16.3 |
| App Router, API routes, middleware | minor bump; no documented migration for 16.2 → 16.3 |
| Image optimisation | directly implicated by one advisory; must be exercised |
| Standalone build | the production image target; must be built |
| Generated types | `.next/dev/types` regenerates; a stale copy has already caused a false typecheck failure in this repository once |
| Playwright | drives the built app; unaffected by the upgrade except through it |

## Verification strategy

Baseline first, then upgrade, then the same commands, then compare. The suite
is not assumed green beforehand: `SPEC-0007`/`CONV-015` makes the persona suite
intermittently red, so the baseline is captured over repeated runs and
attribution is against that, not against an assumption.

## Rollback

Revert the commit. Two files, no migration, no configuration, no data.

---

# Revision 2 — 2026-09-09

`AD-001` to `AD-006` above are retained as the record of how the three-package
target was derived. They are **delivered by `#48`** and are not re-decided here;
`EVC-022` explains why. The decisions below are the narrowed change.

## `AD-007` — The floor is declared, not merely resolved

`overrides.sharp` moves from `^0.35.0` to `^0.35.4`.

The alternative was to leave the manifest alone and rely on the lockfile, which
already carries `0.35.4` from `#48`. Rejected on measurement rather than on
principle: with `overrides.sharp` at `0.35.3` and `next@16.3.4` — which declares
`sharp: ^0.35.4` itself — npm resolved `node_modules/next/node_modules/sharp` to
`0.35.3` and the audit reported 2 high. An `overrides` entry replaces the parent
package's declared range; it does not defer to it. So the lockfile is a fact
about today and the override is the rule about tomorrow, and only the rule
survives a regeneration.

`^0.35.4` rather than `0.35.4` exact: a caret floor still admits patch and minor
fixes within `0.35.x`, which is what a security floor should do. An exact pin
would freeze the library at the version that happened to be current when the
advisory was published, and the next `sharp` advisory would then require a
manifest change instead of a lockfile refresh.

## `AD-008` — The lockfile is reconciled, not regenerated

`npm install --package-lock-only` after the manifest edit, not `npm update`, not
`npm audit fix`, not deleting the lockfile. On the `#48` graph `sharp` already
resolves to `0.35.4`, so the expected delta is the `overrides` mirror in the
lockfile root or nothing at all. Any other package changing resolved version is
a defect in the remediation and `UT-001` fails on it.

## `AD-009` — The change is proved by breaking it

`ST-007` forces the override below the floor in a scratch tree, regenerates, and
asserts the advisory returns. This is unusual and it is deliberate: on the
current graph the resolved version is already correct, so every other test
passes identically before and after the change. Without `ST-007` this
specification would ship a line of JSON with no evidence it does anything.

The scratch tree is a temporary directory. No manifest in the repository is
written by the test.

## `AD-010` — The other four overrides are named, not fixed

`postcss`, `nanoid`, `deepmerge-ts` and `mysql2` have the same structural
weakness: each declares a floor that npm will honour over the parent's own
range. None carries a current production advisory, so none is changed. `UT-005`
generalises the assertion so that the next one to acquire an advisory fails a
test rather than waiting to be rediscovered, and `RISK-002` records the
remainder.

## Expected diff, revision 2

| File | Change |
|---|---|
| `apps/web/package.json` | one line: `"sharp": "^0.35.0"` to `"sharp": "^0.35.4"` |
| `apps/web/package-lock.json` | the `overrides` mirror in the root entry, or no change |
| `apps/web/tests/` | `ST-007`, `UT-001`, `UT-005` — new cases, added under `TASK-002` |

No resolved version is expected to move. That is the point: the graph is already
correct, and this change is what keeps it correct.
