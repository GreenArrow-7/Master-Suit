# SPEC-0009 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |

> **Revision 2, 2026-09-09.** Narrowed with the specification. `TASK-001` was
> executed under revision 1 and is retained verbatim in purpose; its evidence is
> in `execution/TASK-001-baseline.md` and remains valid, since a baseline of the
> tree does not become wrong when the scope narrows. `TASK-002` to `TASK-004`
> are rewritten to the narrowed scope. Nothing is renumbered.

**No task after `TASK-001` may begin before gate 1, gate 3 and gate 5 are
recorded.** At R4 an agent may prepare everything here and may not start
`TASK-002` until a human has accepted the plan. `CL-006` asks whether R4 is
still the correct level for the narrowed change; until that is answered, the R4
gates apply.

**`TASK-002` additionally requires that `#48` is integrated into
`dev/yourhan-next` first.** Against a tree where `sharp` is still `0.35.3` this
change would force an upgrade rather than hold one, which is a different and
larger change than the one specified.

---

## TASK-001

**Purpose:** capture the baseline, so that "no new failures" is a comparison
rather than a claim.

**Requirements:** `OBS-001`.

**Dependencies:** none. This is the only task that may run before approval, as
it changes nothing.

**Allowed scope:** none

**Prohibited paths:** `apps/web/`, `.github/workflows/`, `specs/`, `docs/`

**Expected files and components:** no file changes. Recorded: the audit result
by severity, the resolved versions, the full suite result, the build, and the
CI status of the affected pull requests.

**Required tests:** none. This task produces the baseline the others compare
against.

**Security implications:** none directly. Its value is that it makes a later
"nothing regressed" claim falsifiable.

**Data and migration implications:** none.

**Status:** EXECUTED 2026-09-09. Evidence:
`execution/TASK-001-baseline.md`. Its first command found `#48` and produced
`EVC-022`, which is what narrowed this specification.

---

## TASK-002

**Purpose:** make the declared `sharp` floor equal the required floor.

**Requirements:** `FR-001`, `FR-002`, `FR-004`, `NFR-001`, `SEC-001`, `SEC-003`.

**Dependencies:** `TASK-001`; `#48` integrated into `dev/yourhan-next`.
**Gates 1, 3 and 5 recorded.**

**Allowed scope:** `apps/web/package.json`, `apps/web/package-lock.json`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`, `apps/web/tests/`,
`.github/workflows/`, `apps/web/infra/`

**Expected files and components:** `overrides.sharp` changed from `^0.35.0` to
`^0.35.4` — one line. The lockfile updated only if npm's deterministic
resolution alters it; on the `#48` graph `sharp` is already `0.35.4`, so the
expected delta is the `overrides` mirror or nothing. No other `overrides` entry
is touched. `npm audit fix` and `npm audit fix --force` are not used; the edit is
made by hand and the lockfile reconciled with `npm install --package-lock-only`.

**Required tests:** `ST-001`, `ST-002`, `ST-003`, `ST-007`, `UT-001`, `UT-005`

**Security implications:** this task is the security control. The cheapest wrong
answers are both available here: writing the floor into the lockfile only, which
a regeneration undoes, and widening the change to "refresh dependencies", which
buries a one-line control in noise. `ST-007` proves the first did not happen and
`UT-001` proves the second did not.

**Data and migration implications:** none.

---

## TASK-003

**Purpose:** prove the change did not alter behaviour.

**Requirements:** `FR-005`, `NFR-002`, `SEC-002`.

**Dependencies:** `TASK-002`.

**Allowed scope:** none

**Prohibited paths:** `apps/web/`, `.github/workflows/`, `docs/`, `specs/`

**Note.** No test may be edited to accommodate the change. If one needs changing
to pass, that is the finding, not the fix.

**Expected files and components:** no file changes. Produced: the full suite
result, the security and tenant suites, the build, `npm ci` reproducibility, and
the client walkthrough.

**Required tests:** `ST-004`, `ST-005`, `ST-006`, `UT-002`, `UT-003`, `UT-004`,
`REG-001`, `IT-001`, `IT-003`, `E2E-001`

**Security implications:** the existing suites are the control, and their value
depends entirely on their not being adjusted to fit.

**Data and migration implications:** none.

---

## TASK-004

**Purpose:** report what remains, and hand the decision to a human.

**Requirements:** `OBS-001`, `AC-007`.

**Dependencies:** `TASK-003`.

**Allowed scope:** `specs/SPEC-0009-runtime-dependency-security-remediation/`

**Prohibited paths:** `apps/web/`, `.github/workflows/`

**Expected files and components:** the convergence report, listing every
remaining production advisory by name and severity — expected to be none — the
development-only advisories that `--omit=dev` does not evaluate, and `RISK-002`
stated so that the other four `overrides` entries are a recorded follow-up
rather than a silent omission.

**Required tests:** none.

**Security implications:** the honesty of the report is the control. A
convergence record saying "audit green" without listing what is still there
would be true and misleading.

**Data and migration implications:** none.
