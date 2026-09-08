# B2 specification audit — did B2 follow B1?

Phase B2 is itself a material engineering change, so it was required to go
through the process it was building. This audit checks that it actually did,
rather than writing the specification afterwards to look compliant.

## The specification

`specs/SPEC-0001-sdd-verification-enforcement/`. `SPEC-0001` was unallocated,
so it was used, as the brief directed.

| Artefact | Present | Notes |
|---|---|---|
| `spec.md` | yes | 21 requirements, 7 acceptance criteria, all 25 mandatory sections |
| `clarifications.md` | yes | `CL-001` to `CL-005`, all `INCORPORATED` |
| `plan.md` | yes | 25 sections, 8 `AD-` decisions |
| `threat-model.md` | yes | 6 threats, 5 controls, 1 accepted residual risk |
| `test-plan.md` | yes | 21 cases plus a 32-row invalid-fixture matrix |
| `tasks.md` | yes | 12 tasks, each citing a requirement or a decision |
| `traceability.md` | yes | Full matrix, acceptance view, security view, 10 gap checks |
| `convergence.md` | yes | 15 checks, 3 findings, verdict recorded |
| `sdd.json` | yes | Manifest with a 12-step lifecycle history and 3 approvals |
| `change-record.md` | yes | `CHG-001`, the scope change that brought CI into scope |

## Risk classification

**R3.** The work creates new repository tooling with real logic, touching no
application code, no schema, no dependency and no security surface of the
product.

The classification was tested against the escalation triggers in
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`:

| Trigger | Applies |
|---|---|
| Touches `src/lib/auth/*` or `src/lib/security/*` | no |
| Moves tenant, permission or visibility scope | no |
| Destructive or long-locking migration | no |
| Environment variable in a deployed environment | no |
| New outbound data flow | no |
| Retention, audit or biometric handling | no |
| Blast radius not obvious | no |

One part of the original brief **would** have triggered escalation: creating a
CI workflow, which is R5. That part was moved out of scope rather than being
carried at the wrong risk level, and was later brought back in under `CHG-001`
once it had its own authorisation. See below.

R3 requires a full specification, clarifications, plan, test plan,
traceability and convergence — all present. A threat model is required at R3
only when the change is security-sensitive; one was produced anyway, because
the tool parses attacker-controlled content.

## Was the order genuine?

Yes, and it is visible in the artefacts rather than merely asserted:

- The specification was written before `tools/sdd/` existed. Its Evidence
  section records that `tools/` did not exist at the time.
- `CL-005` decided the CI question **before** implementation, which is why no
  `.github/` file was created during the original phase rather than created
  and then removed. The one that exists today arrived later, through change
  control.
- `AD-001` chose `sdd.json` before the manifest format was implemented, and
  `TASK-001` delivered it.
- The test plan's invalid-fixture matrix was written before the fixtures, so
  the tests were designed against requirements rather than against whatever
  the code turned out to do.

One honest wrinkle: `sdd.json` for `SPEC-0001` could not exist until the
manifest format was defined, since the format is itself a B2 deliverable. The
specification's Markdown artefacts came first and the manifest was added by
`TASK-001`. That ordering is recorded here rather than smoothed over.

## The gate B2 stopped at, and how it was later passed

The authorisation for Phase B2 stated it was not infrastructure approval, and
instructed the work to stop at any gate it could not satisfy.
`.github/workflows/*` is R5 and requires Solution Architect and DevOps
approval.

**The work stopped.** No file under `.github/` was created, the workflow was
prepared in `docs/sdd/CI_ENFORCEMENT.md` with both approvals named as pending,
and `TASK-012` placed `.github/` outside the allowed scope of every task.
Creating it anyway would have been a process violation committed by the change
whose purpose is preventing process violations.

The requester subsequently authorised the addition in writing, subject to named
safety conditions. Because the specification was already `CONVERGED`, the
change was not made by editing it: `CHG-001` records a `SCOPE CHANGE`, and the
specification returned `CONVERGED -> IMPLEMENTING -> VERIFYING -> CONVERGED`.
`SDD-V018` confirms every transition is legal.

This is the more useful demonstration. A process that only works while nothing
changes is not a process; the round trip through change control is what shows
it holds when scope moves after approval.

## Did the validator validate its own specification?

Yes, and it failed the first time. Three tasks cited no requirement
(`SDD-V026`) and several document references were unqualified (`SDD-V040`).
The artefacts were corrected. Separately, `SDD-V030` proved inert and the
validator was corrected. In each case the layer that was actually wrong was
fixed, and no rule was weakened to obtain a pass. Recorded as `CONV-002` and
`CONV-003`.

`node tools/sdd/cli.mjs validate --all` now reports `result=PASS  errors=0
warnings=0`, exit 0.

## Approval status

| Gate | Role | Status |
|---|---|---|
| Specification approval | Product Owner | recorded |
| Architecture approval | Solution Architect | recorded |
| Architecture approval, R5 CI element | DevOps / Production Engineering | recorded via `CHG-001` |
| Implementation readiness | — | not required at R3 |
| Convergence acceptance | reviewer | **pending** — R3 requires a human to accept |

The convergence verdict is a recommendation. An agent does not mark its own
work converged.

## Evidence Sources

E1: the ten artefacts in `specs/SPEC-0001-sdd-verification-enforcement/`;
`git status` showing `.github/workflows/sdd-validate.yml` as the only added
workflow and `ci.yml`, `deploy.yml`, `build-images.yml` unmodified.
E3: `tools/sdd/tests/validator.test.mjs`.
E4: `docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md`.
