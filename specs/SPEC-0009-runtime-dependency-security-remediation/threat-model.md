# SPEC-0009 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0009` |
| Risk | `R4` |
| Approver | Application Security (gate 3) |

## Assets

| Asset | Why it matters here |
|---|---|
| The request path | `next` mediates every request, including authenticated ones |
| Session handling | issued and validated on routes the framework routes |
| Tenant isolation | enforced below the framework, but reached through it |
| The build artefact | what is deployed; produced by the upgraded framework |
| The dependency graph | the thing being changed, and the thing an attacker would like changed |

## Trust boundaries

Unchanged by this work. The upgrade moves a framework version; it introduces no
new network boundary, no new credential, no new data flow.

## Threats and controls

- `TH-001` — The upgrade is skipped and the advisories are hidden instead, by an
  ignore file, an `--audit-level` change, or an override that pins a package
  below its advisory. CI goes green and the vulnerability remains.
  Controls: `CTRL-001`, `CTRL-002`. Verified by `ST-001`, `ST-002`.

- `TH-002` — The critical advisories are unauthenticated remote code execution,
  one of them in image optimisation. Until the upgrade lands, any deployed
  environment on 16.2.12 is exposed. Nothing is deployed today, which bounds the
  exposure to future deployments rather than removing it.
  Controls: `CTRL-003`. Verified by `ST-001`.

- `TH-003` — `next@16.3.3` is chosen as "the minimum", and readmits the
  vulnerable `sharp` through its own `^0.35.3` constraint. The audit would still
  fail, or worse, pass locally and fail in CI on a different platform binary.
  Controls: `CTRL-004`. Verified by `ST-003`.

- `TH-004` — The framework upgrade silently changes authentication, session or
  authorization behaviour. A dependency bump is not usually thought of as a
  security change, which is exactly why this one is R4.
  Controls: `CTRL-005`. Verified by `ST-004`, `ST-005`, `ST-006`.

- `TH-005` — The lockfile is regenerated wholesale rather than updated, pulling
  unreviewed versions of unrelated packages into a security fix that will be
  reviewed quickly because it is urgent.
  Controls: `CTRL-006`. Verified by `ST-007`.

- `TH-006` — The `nodemailer` upgrade changes address or content handling such
  that a real message is dispatched from a test or demo run.
  Controls: `CTRL-007`. Verified by `ST-008`.

- `TH-007` — The change is verified only on Windows. The platform binaries that
  move here are not the ones CI resolves, so a green local run is taken as
  evidence for an environment it does not describe.
  Controls: `CTRL-008`. Verified by `ST-009`.

- `TH-008` — Urgency is used to shorten review. The advisory is critical, two
  pull requests are blocked, and a P0 fix is behind it — every incentive points
  at merging quickly.
  Controls: `CTRL-009`.

## Controls

- `CTRL-001` — `NFR-001` forbids suppression in any form, and the reviewer is
  asked to check the diff for it specifically rather than to infer it from a
  green run.
- `CTRL-002` — The audit is re-run from the committed lockfile, not from a
  working tree, so a local-only resolution cannot make it pass.
- `CTRL-003` — The upgrade is taken to a version at or above the advisories'
  fixed range, evidenced per advisory rather than in aggregate.
- `CTRL-004` — The `next` target is chosen against `sharp`'s constraint as well
  as its own advisory range; `AD-001` records why 16.3.3 is insufficient.
- `CTRL-005` — The existing security suite is the control: `tests/security` and
  `tests/tenant` run unchanged, and the client walkthrough exercises sign-in,
  both modules, session continuity, tenant isolation and platform-admin denial.
  Not one of them is modified by this change; a test edited to accommodate an
  upgrade would be the finding.
- `CTRL-006` — The lockfile diff is bounded by `FR-005` and was measured by dry
  run before approval: 7 packages, 0 added, 0 removed.
- `CTRL-007` — The mail provider is `mock` in test and demo configurations, and
  no vendor credential is present. `ST-008` asserts both rather than assuming.
- `CTRL-008` — `npm ci` from the committed lockfile is what CI runs; the
  lockfile carries every platform's binary, and CI is the evidence for CI.
- `CTRL-009` — R4 requires two human reviewers, one security-literate, and
  Application Security accepts the residual risk. Urgency does not change the
  gate; it changes how quickly the humans are asked.

## Residual risk

`RISK-001` from the plan: this is a minor framework upgrade and the framework is
on the authenticated request path. The mitigation is the existing security and
tenant suites plus the end-to-end walkthrough, none of which are modified here.
That is a real mitigation and not a complete one — no suite proves the absence
of a behaviour change. Application Security is asked to accept that explicitly
rather than to have it implied by a green run.

Moderate advisories remain after this change, by decision (`CL-004`). They are
listed in the convergence report rather than omitted.

---

# Revision 2 — 2026-09-09

`TH-001` to `TH-008` and `CTRL-001` to `CTRL-009` above are retained. Two are
retired with the scope that carried them, and one threat is added.

**Retired.** `TH-002` — choosing a `next` target that does not clear the
advisory — and `TH-006` — the `nodemailer` upgrade dispatching real mail — both
belong to `#48`. They are not this specification's risks any longer, and
carrying them forward would overstate what these gates are being asked to
accept.

## `TH-009` — A sibling override quietly holds a vulnerable floor

**Threat.** The reasoning that makes `overrides.sharp` dangerous applies
unchanged to `postcss`, `nanoid`, `deepmerge-ts` and `mysql2`. Each declares a
floor npm honours over the parent package's own range. None carries a production
advisory today. The threat is that one acquires an advisory later, the override
holds the tree below the fix, and the audit gate reports it as a transitive
problem in someone else's package — sending the next reader to the wrong file.

**Likelihood.** Moderate over time; this is how the `sharp` case arose.

**Impact.** Equal to whatever the advisory is. The override does not create the
vulnerability; it prevents the ordinary fix from taking effect.

**`CTRL-010`.** `UT-005` enumerates every `overrides` entry and asserts none
declares a floor below a version covered by a current production advisory. The
control is a test rather than a policy, because a policy about a JSON file that
nothing reads is not a control.

**Residual.** `UT-005` can only see advisories the registry already publishes.
It closes the gap between "an advisory exists" and "someone thought to look at
the overrides block", which is the gap this specification fell into. It does not
close the gap between publication and the next test run. That is the recurrence
problem, and `CL-005` keeps it deliberately out of scope.
