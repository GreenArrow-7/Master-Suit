# SPEC-0009 — Clarifications

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |
| Last updated | 2026-09-09 |

---

- `CL-001` — Upgrade `next` to 16.3.3 or 16.3.4?

**Status:** RESOLVED · answered from advisory and registry metadata.

**Resolution: 16.3.4.** 16.3.3 is the lowest version that clears the two
critical advisories, whose range is `>=16.0.0 <16.3.3`. It is not sufficient.
`next@16.3.3` declares `sharp: ^0.35.3`, which still admits the vulnerable
`sharp@0.35.3`; `next@16.3.4` declares `^0.35.4`, which does not. Choosing
16.3.4 means the fixed `sharp` is required by the framework rather than merely
permitted by our own override, so the fix cannot be undone by someone tidying
the overrides later.

16.3.4 is also the current latest 16.x, is not a semver major, and its peer
range on React (`^19.0.0`) is already satisfied by the installed 19.2.8.

---

- `CL-002` — Does `nodemailer` need a `apps/web/package.json` change?

**Status:** RESOLVED · answered from the declared range.

**Resolution: no.** The declared range is `^9.0.4` and the fixed version is
`9.1.1`, which is inside it. A lockfile refresh is sufficient. `9.1.1` clears
all four `nodemailer` advisories, including the two moderates whose range is
`<=9.1.0` — so taking `9.1.1` rather than the minimum `9.1.0` costs nothing and
removes more.

The alternative, `nodemailer@10`, is a semver major and is not required by any
advisory. It is out of scope.

---

- `CL-003` — Should the `sharp` override be tightened?

**Status:** OPEN · recommendation stated, decision belongs to Application
Security at gate 3.

**Question.** `sharp` is not a direct dependency. It arrives through `next`, and
its version is currently decided by an existing `overrides` entry in
`apps/web/package.json`, `sharp: ^0.35.0`. That range already admits the fixed
`0.35.4`, so `npm update sharp` moves it with no `apps/web/package.json` change at all.

**Recommendation: tighten the override to `^0.35.4` anyway.** Leaving it at
`^0.35.0` means the lockfile is the only thing keeping the fixed version in
place, and a future lockfile regeneration could legitimately resolve back to
`0.35.3`. One character of range is cheaper than rediscovering this advisory.

**Against:** it is a second `apps/web/package.json` line in a change whose stated aim is
the smallest possible diff, and with `next@16.3.4` requiring `^0.35.4` the
framework already enforces the floor. Both arguments are real; the override is
belt to the framework's braces.

---

- `CL-004` — What is done about the moderate advisories that remain?

**Status:** OPEN · default applies if undecided.

**Question.** The gate is `--audit-level=high`. Advisories below that threshold
are not remediated by this change and are not made urgent by it.

**Default if undecided.** Report them, register them, and do not fix them here.
Widening this change to chase moderates would enlarge the regression surface of
a change whose entire justification is a critical advisory.

**Decision owner.** Application Security.

---

- `CL-005` — Should recurrence be prevented as part of this change?

**Status:** OPEN · recommendation is **no**, as part of this change.

**Question.** There is no Dependabot or Renovate configuration in the
repository, and `SEC-OBS-006` already records that CI has no secret-scanning or
SAST step. This advisory reached a release branch because nothing was watching.

**Recommendation.** Fix the vulnerability here; raise the watching separately.
They have different risk levels, different reviewers and different failure
modes, and bundling them would mean a P0-blocking security fix waits on a
tooling decision.

**Decision owner.** Product Owner, with Application Security.

---

# Revision 2 — 2026-09-09

Revision 1 above is retained rather than rewritten. `EVC-022` established that
the three-package upgrade was already delivered by pull request `#48`, and the
human scope decision narrowed this specification to the `sharp` override floor
alone. That changes the status of four of the five clarifications above, and one
of them contained an argument I had asserted without measuring.

Dispositions, revised — these are updates to the entries above, not new
entries:

| Entry | Revised status | Basis |
|---|---|---|
| First | CLOSED, delivered by `#48` at 16.3.4 | 16.3.3 declares `sharp: ^0.35.3` and readmits the vulnerable version; registry-verified at `TASK-001`. `#48` reached the same target independently. |
| Second | CLOSED, delivered by `#48` | `^9.0.4` admits `9.1.1`; no manifest change was needed and `#48` made none. |
| Third | **RESOLVED — tighten to `^0.35.4`** | Recorded by the human as an Application Security decision on 2026-09-09. Now the entire remaining scope. See the correction below. |
| Fourth | RESOLVED, and the question is empty | Measured against the `#48` graph, `npm audit --omit=dev` reports 0 critical, 0 high, 0 moderate, 0 low. No production advisory remains at any severity. |
| Fifth | Unchanged, still OPEN, recommendation still no | Recurrence watching is more clearly out of scope for a one-line floor change than for a three-package upgrade. |

## Correction to the third entry

Its "Against" paragraph argued that tightening was optional because "with
`next@16.3.4` requiring `^0.35.4` the framework already enforces the floor."
**That is wrong, and I asserted it without measuring it.**

An `overrides` entry replaces the parent package's declared range; it does not
defer to it. Measured in an isolated tree: `next@16.3.4` with `overrides.sharp`
forced to `0.35.3` resolved `node_modules/next/node_modules/sharp` to `0.35.3`
and audited **2 high**. The same tree at `^0.35.4` reports `found 0
vulnerabilities`. The override is not belt to the framework's braces — while it
stands, it *is* the only floor.

## Development-only advisories, for the fourth entry

Outside the `--omit=dev` gate and out of scope: `js-yaml` high (transitive),
`vitest` and `@vitest/mocker` moderate, `autocannon` and `hyperid` moderate,
`uuid` moderate. Reported under `AC-007`, not remediated here.

---

- `CL-006` — Does the narrowed change still qualify as `R4`?

**Status:** OPEN · recommendation stated, decision belongs to the Solution
Architect. **Raised because the human directed that `R4` must not be retained
automatically.**

**Question.** Revision 1 was classified `R4` on blast radius: a framework minor
upgrade on the code path carrying every authenticated request. That
justification is gone — the upgrade is delivered, and what remains is one
declaration line in `apps/web/package.json` that changes no resolved version on
the current graph.

Against `docs/RISK_CLASSIFICATION.md` the narrowed change touches nothing the
`R4` row enumerates: no `src/lib/auth/*`, no `src/lib/security/*`, no
permissions, visibility rules, RLS, session or MFA behaviour, audit logging,
PII, AI redaction, retention or outbound data flow. It touches no source file at
all. It touches nothing in the `R5` row either. On surface alone it would sit at
`R2`.

**Recommendation: retain `R4`, on new grounds.** Two reasons.

1. `docs/sdd/BUG_WORKFLOW.md` places a fix with any security dimension at `R4`
   or above with Application Security involved from the report. The subject of
   this change is a security control.
2. More decisively: the *entire content* of the change is the threshold of that
   control. `AC-004` and the measurement under `CL-003` show that setting it
   wrong reintroduces a high advisory. The role qualified to accept "0.35.4 is
   the correct floor" is Application Security, and `R4` is the level that
   requires them. Reclassifying to `R2` would let the agent that proposed the
   floor also self-check it, which is the separation `R4` exists to enforce.

**Against.** `docs/RISK_CLASSIFICATION.md` says plainly "do not inflate," and
`docs/sdd/BUG_WORKFLOW.md` separates the severity of the symptom from the risk
of the fix. By that reading the fix is `R2` and the recommendation above
inflates it. The argument is real and is not dismissed; it is recorded so that
whoever decides sees both.

**Consequence of the recommendation.** Gates 1 (Product Owner **and** Solution
Architect), 3 (Application Security) and 5 (Solution Architect) are required,
and no implementation may begin until all three are recorded.

**Decision owner.** Solution Architect.
