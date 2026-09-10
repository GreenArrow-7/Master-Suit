# SPEC-0009 — Approval packet

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` recommended; see `CL-006`, open for the Solution Architect |
| Status | `READY_FOR_APPROVAL` |
| Prepared | 2026-09-09, against the merged graph on `dev/yourhan-next` at `98fa066` |

**Nothing below is recorded as approved.** These are the decisions being asked
for, written out so that a role holder can give or refuse one without composing
it. An agent prepared them and holds none of them. `sdd.json` carries zero
approvals and will carry only what a human actually says.

## What is being asked for, in one paragraph

One line of `apps/web/package.json` changes: `overrides.sharp` from `^0.35.0` to
`^0.35.4`. No version in the resolved graph moves, because `sharp` is already
`0.35.4` there. The change makes the floor *declared* rather than *coincidental*.

## Why it is not cosmetic

An npm `overrides` entry **replaces** the parent package's own declared range
rather than deferring to it. `next@16.3.4` declares `sharp: ^0.35.4`; the
override at `^0.35.0` overrides that. Measured twice — before the merge and
again against the merged graph — in an isolated scratch tree that wrote nothing
to the repository:

| `next` | `overrides.sharp` | resolved `sharp` | `npm audit --omit=dev` |
|---|---|---|---|
| 16.3.4 | `^0.35.0` (as committed today) | 0.35.4 | `found 0 vulnerabilities` |
| 16.3.4 | `0.35.3` | **0.35.3** | **2 high** |
| 16.3.4 | `^0.35.4` | 0.35.4 | `found 0 vulnerabilities` |

The tree is correct today only because `^0.35.0` resolves to the highest
matching version, which happens to be the patched one. The floor the manifest
*guarantees* is `0.35.0`, which `GHSA-rgj7-g3m4-5g8c` covers. Any future
lockfile regeneration is free to land there.

## What is explicitly not in scope

The `next` `16.2.12` → `16.3.4`, `nodemailer` → `9.1.1` and `sharp` → `0.35.4`
upgrades are **delivered by pull request `#48`**, merged as `98fa066`. `EVC-022`
records that this specification was created on the false premise that they were
unowned. They are not reimplemented here and this packet does not re-approve
them.

---

# Gate 1 — specification approval

**Roles required at R4: Product Owner *and* Solution Architect.** Both.

> **Approved:** `SPEC-0009` as narrowed in revision 2 — hardening the `sharp`
> security floor and nothing else.
>
> The scope is one line of `apps/web/package.json`: `overrides.sharp` from
> `^0.35.0` to `^0.35.4`, with `apps/web/package-lock.json` updated only if
> npm's deterministic resolution requires it. No product behaviour changes and
> no resolved dependency version moves.
>
> I accept that the three-package upgrade this specification was originally
> written for is **delivered by `#48`** and is attributed there rather than
> repeated here, and that `FR-006` of revision 1 is retired rather than
> renumbered.
>
> **This does not approve** implementation, which is gate 5, nor the security
> judgement that `0.35.4` is the correct floor, which is gate 3.

## Gate 2 — architecture approval

**Not required.** The R4 row of `docs/sdd/RISK_TO_PROCESS_MATRIX.md` asks for
Solution Architect architecture approval; `AD-007` to `AD-010` introduce no new
pattern, no new component and no new dependency. If the Solution Architect
considers a manifest floor an architectural decision, gate 1's second signature
covers it and no separate record is proposed.

---

# Gate 3 — security risk acceptance

**Role required: Application Security.**

> **Approved:** the security position of `SPEC-0009` revision 2, specifically:
>
> 1. **`sharp` minimum `>= 0.35.4`**, the fixed version for
>    `GHSA-rgj7-g3m4-5g8c` (high, libheif).
> 2. **The override floor becomes `^0.35.4`.** Caret rather than an exact pin,
>    so patch and minor fixes inside `0.35.x` are still admitted; an exact pin
>    would freeze the library at the version current when the advisory was
>    published and make the next `sharp` advisory a manifest change instead of a
>    lockfile refresh.
> 3. **No audit suppression of any kind.** No ignore file, no `--audit-level`
>    change, no `overrides` entry added to hide an advisory, and
>    `.github/workflows/ci.yml`'s Audit step is untouched. `ST-002` asserts it.
> 4. **Target and current state: CRITICAL 0, HIGH 0.** Verified on the merged
>    graph: `npm audit --omit=dev --audit-level=high` exits 0 with
>    `found 0 vulnerabilities` — 0 critical, 0 high, 0 moderate, 0 low in
>    production.
> 5. **Deterministic lockfile.** The manifest edit is made by hand and
>    reconciled with `npm install --package-lock-only`. `npm audit fix` and
>    `npm audit fix --force` are not used. `UT-001` fails if any package other
>    than `sharp` changes resolved version.
> 6. **No unrelated dependency churn.** Expected diff: one `package.json` line,
>    and in the lockfile the `overrides` mirror or nothing at all.
> 7. **Remaining advisories, stated rather than omitted** (`AC-007`): production
>    has **none** at any severity. Development-only, outside the `--omit=dev`
>    gate and out of scope: `js-yaml` high (transitive), and `vitest`,
>    `@vitest/mocker`, `autocannon`, `hyperid`, `uuid` moderate.
>
> **Accept explicitly or require fixed:** `RISK-002` — the other four
> `overrides` entries (`postcss`, `nanoid`, `deepmerge-ts`, `mysql2`) share the
> same structural weakness and are deliberately not changed, none carrying a
> current production advisory. `UT-005` generalises the assertion so the next
> one to acquire an advisory fails a test rather than being rediscovered.

---

# Gate 5 — implementation readiness

**Role required: Solution Architect.**

> **Approved:** `TASK-002` may begin.
>
> `TASK-001` is executed and its evidence is recorded. `#48` is merged to
> `dev/yourhan-next` at `98fa066`, which `TASK-002` depends on: against a tree
> where `sharp` were still `0.35.3` this change would *force* an upgrade rather
> than hold one, which is a larger change than the one specified.
>
> Allowed scope is `apps/web/package.json` and `apps/web/package-lock.json`
> only. `apps/web/src/`, `apps/web/prisma/`, `.github/workflows/` and
> `apps/web/infra/` are prohibited. `ST-007` — which proves the declaration
> rather than the lockfile holds the floor, by forcing it below `0.35.4` in a
> scratch tree and observing the advisory return — runs in a temporary
> directory and writes to no manifest in the repository.
>
> No test may be edited to accommodate the change.

---

# `CL-006` — the risk level, open and asked separately

**Role: Solution Architect.** This is a genuine question, not a formality, and
it is put separately so that a reader is not asked to approve `R4` merely by
approving everything else.

Revision 1 was `R4` on blast radius — a framework minor on the authenticated
request path. That justification is gone with the upgrade. The narrowed change
touches no surface the `R4` row of `docs/RISK_CLASSIFICATION.md` enumerates: no
`src/lib/auth/*`, no `src/lib/security/*`, no permissions, RLS, session, audit,
PII or outbound flow. It touches no source file at all. On surface alone it
would sit at `R2`.

**Recommendation: retain `R4`, on new grounds** — `docs/sdd/BUG_WORKFLOW.md`
places a fix with any security dimension at `R4` or above, and more decisively
the entire content of the change is the threshold of a security control, whose
correctness only Application Security is placed to judge. Reclassifying to `R2`
would let the agent that proposed the floor also self-check it.

**Against, and it is not dismissed:** `docs/RISK_CLASSIFICATION.md` says plainly
"do not inflate", and `BUG_WORKFLOW.md` separates the severity of the symptom
from the risk of the fix. By that reading this is `R2` and the recommendation
above inflates it.

> **Decision:** the narrowed `SPEC-0009` is `R<n>`, and the gates required are
> those its risk level carries.

If it is reclassified below `R4`, gates 3 and 5 fall away and gate 1 needs one
signature rather than two; the security reasoning above should then be recorded
as a self-check in `convergence.md` rather than lost.
