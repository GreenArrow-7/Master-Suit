# Change Workflow

`NORMATIVE — engineering process requirement.` The path a normal material
change takes. Bugs use `docs/sdd/BUG_WORKFLOW.md`; incidents use
`docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`.

## The path

```text
REQUEST
  ↓
RISK CLASSIFICATION          docs/RISK_CLASSIFICATION.md
  ↓
SPECIFICATION                specs/SPEC-NNNN-slug/spec.md
  ↓
CLARIFICATION                clarifications.md
  ↓
PLAN                         plan.md
  ↓
SECURITY / TEST DESIGN       threat-model.md, test-plan.md
  ↓
TASKS                        tasks.md
  ↓
TRACEABILITY CHECK           traceability.md
  ↓
APPROVAL                     docs/sdd/HUMAN_APPROVAL_GATES.md
  ↓
IMPLEMENT                    only approved tasks, within their allowed scope
  ↓
VERIFY                       execute the test plan, record real results
  ↓
CONVERGE                     convergence.md
  ↓
RELEASE PROCESS              existing deployment path, human-authorised
```

## Step notes

**Request.** Capture what was actually asked, in the requester's words, before
interpreting it. An interpretation recorded as the request is the first place
requirements go missing.

**Risk classification.** Before any code is read for the purpose of changing
it. The level decides every artefact and gate that follows
(`docs/sdd/RISK_TO_PROCESS_MATRIX.md`). Re-classify upward the moment an
escalation trigger appears.

**Specification.** What and why, per `docs/sdd/REQUIREMENT_STANDARD.md`. For
brownfield work, read and cite the current implementation, and state for each
requirement whether it preserves, changes or replaces existing behaviour.

**Clarification.** Run the checklist in `docs/sdd/CLARIFICATION_STANDARD.md`.
Material ambiguity is raised, not resolved quietly.

**Plan.** How, per `docs/sdd/PLAN_STANDARD.md`. Every material decision gets
an `AD-` that traces to a requirement or a stated engineering constraint.

**Security and test design.** Designed against the requirements, before the
implementation exists, so the tests cannot be shaped by whatever the code
turns out to do.

**Tasks.** Small enough to review, each citing its requirement and declaring
its allowed scope.

**Traceability check.** Run before asking for approval, not after. The
approver should never be the one to discover a requirement has no test.

**Approval.** The gates for the risk level. Material implementation must not
begin until the specification has reached the approval state required by its
risk level. At R4 and R5 that approval is human and is recorded before any
code is written. Every step above this one is specification development and
proceeds without waiting for approval.

**Implement.** Only what the approved tasks describe. Anything else, however
small and however tempting, is a new task or a change record.

**Verify.** Run the tests and the gates. Record what actually happened,
including environmental failures, rather than what was expected.

**Converge.** `convergence.md`, with a verdict and named owners for any
accepted limitation.

**Release.** The existing deployment path. `VERIFIED` from
`.github/workflows/deploy.yml` and `apps/web/scripts/release.sh`: production
deploys are manual, gated on a green `verify` check, protected by a GitHub
environment, and promote the tag staging is running. Whether those protections
are configured as intended in the account is
`UNKNOWN — requires runtime/infrastructure verification` (EVC-003, U-09,
U-10). An agent never performs the release.

## STOP conditions

Work stops, and the agent reports rather than proceeding, when any of these
holds:

1. A material requirement is unresolved or a material clarification is OPEN.
2. A security boundary is unclear — which actor, which scope, which tenant.
3. A required approval is missing for the risk level.
4. A required test design is missing.
5. Scope has expanded beyond the approved tasks without a change record.
6. A migration turns out to be destructive, long-locking or irreversible and
   has no approved rollback and restore path.
7. The change would contradict `AGENTS.md`.
8. The change would require touching production, secrets, IAM, DNS, TLS or
   infrastructure that only a human may execute.
9. An open `C4` or release-blocking evidence conflict covers the area being
   changed and the approver has not seen it.
10. Making a check pass would require weakening a test, a lint rule, a type
    check or a security control.

A STOP is reported with: what is blocked, why, what would unblock it, and the
single next action for a human. It is not a failure of the process; it is the
process working.

## Proportionality

R0 and R1 do not walk this whole path. R1 is typically request → risk →
lightweight `SPEC-NNNN/` directory (short `spec.md`) → implement → verify →
review, with a `change-record.md` only if something moves after that. R0 needs
no specification directory at all. The path exists so that material changes
cannot skip the parts that protect the product, not to make a copy edit
expensive.

## Authority / References

- `AGENTS.md` §1, §2, §7, §8
- `docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`
- `docs/sdd/ARTIFACT_AUTHORITY.md`, `docs/sdd/SPEC_LIFECYCLE.md`,
  `docs/sdd/HUMAN_APPROVAL_GATES.md`
- `docs/operations/DEPLOYMENT.md`, `docs/operations/ROLLBACK.md`
- `docs/EVIDENCE_CONFLICTS.md`
