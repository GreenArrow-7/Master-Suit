# Approval validation audit

The single most important question this phase had to answer mechanically:
**can an AI structurally self-approve human-required work?**

## Answer

**No.** A record with `actorType: "ai"` on any human-required gate is an ERROR
(`SDD-V022`), and the absence of a qualifying human record is also an ERROR
(`SDD-V020` for implementation, `SDD-V034` for release). Both have passing
negative tests.

## Approval versus review

B1 distinguished them in prose. B2 makes the distinction structural: two
separate arrays with different shapes, and only one of them can satisfy a
gate.

| | Approval | Review |
|---|---|---|
| Field set | `gate`, `role`, `actorType`, `decision`, `evidenceRef`, `date` | `type`, `role`, `actorType`, `decision`, `evidenceRef`, `date` |
| Satisfies a gate | yes, if human and approved | **never** |
| Gate vocabulary | 9 named gates | not applicable |

The validator resolves gates only against the `approvals` array. A review
entry, however emphatic, cannot discharge an approval requirement. This
matters because "an engineer reviewed the code" and "the Application Security
role approved the security risk" are different claims, and conflating them is
how a gate quietly disappears.

## Gates and enforcement

Nine gates: `specification`, `architecture`, `security`, `dataModel`,
`implementation`, `convergence`, `release`, `emergency`, `residualRisk`. All
nine require a human actor type.

| Rule | Enforces | Test |
|---|---|---|
| `SDD-V020` | R4 and R5 have a human implementation approval before an implementation state | passes |
| `SDD-V021` | Every approval record is structurally complete with a known gate, actor type and decision | passes |
| `SDD-V022` | No `actorType: "ai"` satisfies a human-required gate | passes |
| `SDD-V034` | `RELEASED` carries a human release approval | passes |

`SDD-V020` is deliberately risk-scoped: it fires at R4 and R5, matching
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, which gates implementation on a human
approval only at those levels. Applying it at R2 would contradict the risk
model and make routine work require a ceremony the model does not ask for.

## Personal names are not required

A role plus an `evidenceRef` is sufficient and is preferred. A role survives
staff changes; a personal name in a repository becomes stale and, in a
multi-tenant product's repository, is unnecessary personal data.

## What this proves, and what it does not

**Proves:** a structured record exists, on the right gate, naming a human
actor type, with a decision and a date. An omission is now visible instead of
invisible.

**Does not prove:** that a human made the decision. Anyone who can commit can
write the record. The validator has no way to distinguish a record a human
dictated from one an agent invented.

The honest assurance chain is commit authorship plus code review plus branch
protection, and the third link is currently
`UNKNOWN — requires runtime/infrastructure verification` (GAP-CI-01). Until it
is confirmed, an approval record should be read as bookkeeping, not as
evidence of human agency. This is stated in four documents so that nobody
reads a green run as more than it is.

`AGENTS.md` now forbids an agent from adding a fake approval record, which is
a behavioural rule rather than a technical control. That asymmetry is worth
naming: the strongest protection against an agent forging an approval is
currently the instruction not to, plus human review of the diff.

## Evidence Sources

E1: `tools/sdd/lib/approvals.mjs`, `tools/sdd/lib/manifest.mjs`,
`tools/sdd/lib/validate.mjs`.
E3: the `SDD-V020`, `SDD-V021`, `SDD-V022`, `SDD-V034` tests.
E4: `docs/sdd/HUMAN_APPROVAL_GATES.md`, `docs/sdd/MACHINE_CONTRACT.md`,
`specs/SPEC-0001-sdd-verification-enforcement/threat-model.md` `TH-005`.
