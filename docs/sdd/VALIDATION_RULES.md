# Validation Rules

`NORMATIVE — engineering process requirement.` Introduced by Phase B2
(`SPEC-0001`) and extended by Phase B3 (`SPEC-0002`). Every finding the validator emits carries one of these stable
identifiers. `tools/sdd/rules/rules.mjs` is the machine-side source of
identifier and severity; this document is the human-side source of intent.
The two must agree, and a change to one without the other is a defect.

## Severity

| Severity | Meaning |
|---|---|
| `ERROR` | Blocks validator success. Exit code 1 |
| `WARNING` | Reported, does not block. Becomes blocking under `--strict` or when the transition policy promotes it |
| `INFO` | Informational only |

## Rules

### Structure and identity

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V001` | ERROR | A directory under the specs root is named `SPEC-NNNN-short-slug` |
| `SDD-V002` | ERROR | `specId` and `slug` in the manifest match the directory name |
| `SDD-V003` | ERROR | No two directories claim the same `SPEC-NNNN` |
| `SDD-V004` | ERROR | `sdd.json` exists, is a regular file, is within the size bound, and parses as a JSON object |
| `SDD-V005` | ERROR | `schemaVersion` is a version this validator supports |
| `SDD-V006` | ERROR | `risk` is one of `R0`–`R5` |
| `SDD-V007` | ERROR | `status` is a lifecycle state from `docs/sdd/SPEC_LIFECYCLE.md` |

### Artefacts

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V008` | ERROR | Every declared artefact path is a safe relative path that stays inside the specification directory and exists as a regular file. A traversing or absolute path is rejected, not followed |
| `SDD-V009` | ERROR | The artefacts the risk level and current status require are present. Requirements are status-aware: a convergence report is not demanded of a draft |
| `SDD-V010` | WARNING | A known artefact file on disk is declared in the manifest rather than left undeclared |
| `SDD-V023` | ERROR | R4 and R5 have a threat model once past `PLANNED` |
| `SDD-V024` | ERROR | A test plan exists where the risk level requires one |
| `SDD-V025` | ERROR | A tasks artefact exists where the risk level requires one |
| `SDD-V031` | ERROR | A convergence artefact exists once the lifecycle reaches `CONVERGED` |
| `SDD-V038` | WARNING | An R1 specification does not carry heavy artefacts it is not expected to have |
| `SDD-V039` | ERROR | R0 work has no specification directory at all |

### Manifest and prose agreement

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V011` | ERROR | `Specification ID` in `spec.md` equals `specId` |
| `SDD-V012` | ERROR | `Risk` in `spec.md` equals `risk` |
| `SDD-V013` | ERROR | `Status` in `spec.md` equals `status` |

These three exist because `sdd.json` and `spec.md` state the same three facts.
Divergence is a finding rather than a silent inconsistency.

### Identifiers

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V014` | ERROR | An identifier is declared at most once per artefact. A declaration is a heading or a list bullet; a table cell is a reference, not a declaration |
| `SDD-V015` | ERROR | No identifier is declared in two different artefacts of the same specification |
| `SDD-V016` | ERROR | A fully-qualified reference `SPEC-NNNN/ID` resolves to a specification that exists and an identifier it actually contains |
| `SDD-V037` | ERROR | Change-record identifiers are unique within their owning specification |

### Lifecycle

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V017` | ERROR | No clarification is `OPEN` once the specification has reached an implementation state |
| `SDD-V018` | ERROR | Every step in `statusHistory` is a valid state and every consecutive pair is a legal transition |
| `SDD-V019` | ERROR | `status` equals the final `statusHistory` entry, and the history is not empty |

### Approval

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V020` | ERROR | R4 and R5 have a human `implementation` approval before reaching an implementation state |
| `SDD-V021` | ERROR | Every approval record is structurally complete with a known gate, actor type, decision and date |
| `SDD-V022` | ERROR | No record with `actorType: "ai"` satisfies a gate that requires a human |
| `SDD-V034` | ERROR | `RELEASED` carries a human `release` approval |

What these prove and what they do not: the validator confirms a structured
record exists and names a human actor type. It cannot confirm a human made the
decision. See `docs/sdd/MACHINE_CONTRACT.md`.

### Traceability

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V026` | ERROR | Every task cites a requirement or an approved technical decision |
| `SDD-V027` | ERROR | Every requirement appears in the test plan |
| `SDD-V028` | ERROR | Every `SEC-` requirement is co-located with a security test in the test plan |
| `SDD-V029` | ERROR | Every acceptance criterion appears in the traceability matrix or the test plan |
| `SDD-V030` | ERROR | Identifiers referenced by the traceability matrix are declared somewhere in the specification |

### Convergence

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V032` | ERROR | No `CONV-` finding is `OPEN` while the specification is `CONVERGED` or beyond |
| `SDD-V033` | ERROR | The convergence verdict is `PASS`, `PASS WITH ACCEPTED LIMITATIONS` or `FAIL` |

### References

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V035` | ERROR | Every cited `EVC-NNN` is declared in `docs/EVIDENCE_CONFLICTS.md` |
| `SDD-V036` | ERROR | No specification artefact marks an evidence conflict resolved. A specification may cite one; only the register closes one |
| `SDD-V040` | ERROR | Repository documents referenced in backticks exist, resolved against the repository root or the specification directory |

### Change association

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V041` | WARNING | A changed application file is associated with a declared specification. **Advisory during the B2 transition** |

`SDD-V041` is the one rule that touches work predating SDD. It stays a warning
until the conditions in `docs/sdd/ENFORCEMENT_STANDARD.md` are met. Making it
blocking today would fail a brownfield repository for being brownfield.

### Agent execution and separation

Introduced by Phase B3 (`SPEC-0002`). These rules govern how an AI agent may
participate. They check structure and separation, never engineering quality.

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V042` | ERROR | The requested agent role is one of the seven in `docs/sdd/AGENT_ROLE_MODEL.md` |
| `SDD-V043` | ERROR | The specification's lifecycle state permits that role to act |
| `SDD-V044` | ERROR | The requested task exists in `tasks.md`, is not withdrawn, and every task a session names exists |
| `SDD-V045` | ERROR | An implementer's task declares an allowed scope |
| `SDD-V046` | ERROR | Every changed file falls inside the session's approved scope |
| `SDD-V047` | ERROR | The agent session record parses and carries the required fields |
| `SDD-V048` | ERROR | A session's `specId` matches the specification it is stored under |
| `SDD-V049` | ERROR | A required verification record exists, parses and carries the required fields |
| `SDD-V050` | ERROR | A review record parses and carries the required fields |
| `SDD-V051` | ERROR | The reviewing actor and session differ from the reviewed session's |
| `SDD-V052` | WARNING | Repository drift since session start is surfaced for review |
| `SDD-V053` | ERROR | A review with `actorType` `ai` does not claim to satisfy a human-required gate |
| `SDD-V054` | ERROR | Every test identifier a verification cites exists in the test plan |
| `SDD-V055` | ERROR | Every review cites an execution session that exists |
| `SDD-V056` | ERROR | Declared scope paths are relative, contained, and free of traversal or escaping links |
| `SDD-V057` | ERROR | `COMPLETE` is not claimed while a required test has no recorded verification |
| `SDD-V058` | ERROR | No protected path was modified without an approved scope expansion |

Three of these carry most of the weight.

`SDD-V051` is separation of duty. It compares recorded actor labels and session
identifiers, so it proves two records are distinct. It does not prove two minds
considered the work, and `docs/sdd/AGENT_ROLE_MODEL.md` says so plainly.

`SDD-V052` is a warning on purpose. Concurrent human work in the same tree is
normal and legitimate. The rule asks for review; it never authorises an agent
to revert or overwrite what it did not write.

`SDD-V057` is the rule that stops "I wrote the code" from being filed as "the
work is verified". Those are different claims made by different actors, and
collapsing them is the most common way an agent overstates what it did.

### Specification approval at R3

Introduced by `SPEC-0002/TASK-015`, enforcing the `EVC-015` Option A policy.
These are **gate 1**, and are deliberately separate from `SDD-V020`, which is
**gate 5**, the R4/R5 implementation-readiness approval. The two gates ask
different questions and are never conflated.

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V059` | ERROR | An R3 specification in an implementation state has a valid human specification approval by a Product Owner or Solution Architect |
| `SDD-V060` | ERROR | The specification approval is dated no later than the transition into implementation |

`SDD-V059` rejects, each with its own reason: no record, a malformed record,
no approved decision, `actorType: "ai"`, an approval whose evidence names a
different specification, and an approving role outside the permitted two.

`SDD-V060` is separate so that *missing* and *late* stay distinguishable. It
reports only where the recorded dates settle the question; where a date is
absent it says the ordering cannot be established rather than assuming either
way.

A late approval is an immutable historical fact — no edit to the artefact can
make it earlier. Where that blocks a specification, the route is a scoped,
expiring entry in `docs/sdd/VALIDATION_EXCEPTIONS.md` approved by a human, not
a softening of the rule.

### Validation exceptions

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V061` | WARNING | An entry in the exception register is usable: valid id, known rule, exactly one specification, APPROVED, human actor, a permitted approving role, an effective date, an end, a reason and a compensating control |

An approved, correctly scoped exception downgrades **one rule on one
specification** to `INFO`. The finding keeps its rule id and its message and
gains the prefix `EXCEPTED under EXC-NNN`. It is never deleted: a reader must
be able to see that the condition still exists.

The mechanism **fails closed**. A malformed, unapproved, mis-scoped or
wrong-role exception suppresses nothing and the original `ERROR` stands;
`SDD-V061` reports why. Expiry is enforced by `status`, not by comparing a
date to the clock, because the validator must stay deterministic — which puts
the onus on rule 8 of `docs/sdd/VALIDATION_EXCEPTIONS.md`, the human review at
expiry.

There is no specification-specific branch anywhere in the implementation.

## Task scope declarations

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V062` | ERROR | The scope declaration of the task a session is about to act on is machine-readable: every backticked token is a path or a known identifier, no globs, and no prose |

Emitted by **preflight only**, like `SDD-V045` and `SDD-V056`. Scope is
checked when a session acts, not when a document is read, so a malformed
declaration blocks the session rather than failing the repository.

`SPEC-0002/CL-002` permits exact paths and directory prefixes and forbids
globs and patterns. Until `CHG-007` the parser did not enforce that: it
accepted **every** backticked token in a scope declaration as a path, and had
no way to notice that prose in the same region described a boundary nobody had
backticked.

Two consequences, both observed in real artefacts:

- a non-path token became a path — `SPEC-0001/TASK-012` cited `CHG-001` in
  prose and the parser returned it as an *allowed path*;
- a prohibited boundary written in prose was **silently dropped**, which
  under-restricts a session and lets the scope check pass the change it exists
  to catch.

A token is now classified as a path, a known identifier (ignored — these
legitimately appear in prose), or malformed. Malformed tokens are excluded
from the scope rather than admitted, and reported. Separately, a declaration
that still contains prose once its label, backticked spans, punctuation and a
few connectives are removed is reported as not being a complete list.

**Existing declarations that predate this rule stay flagged rather than
rewritten.** They surface when a session is opened on the task, which is the
moment the boundary matters.

### Repository-wide

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V064` | WARNING | Every task in every specification declares a machine-readable scope |

`SDD-V062` refuses a malformed declaration at preflight, which protects new
work but leaves the declarations already in the repository to be discovered one
session at a time. `SDD-V064` reports all of them on every `validate --all`.

Same grammar, same classification, same prose detection. The finding names the
task, so a reader can go straight to it.

**Severity is deliberately `WARNING`, and the reasoning matters.** An `ERROR`
would force one of two bad outcomes: rewriting historical `DONE` task records
so the validator goes green — which alters what a completed session was
measured against — or minting a validation exception, which downgrades the
finding to `INFO` and makes it *less* visible than a standing warning. A
permanent warning is the most honest of the three.

At the time this rule was added, five tasks of thirty-nine were flagged: four
in `SPEC-0001` and one in `SPEC-0003`. Each is classified in
`docs/evidence/phase-b4-pilot/10-historical-scope-declarations.md`. None was
rewritten.

## Historical session evidence

| Rule | Severity | Checks |
|---|---|---|
| `SDD-V063` | WARNING | A closed session carries the end-state evidence needed to re-evaluate it |

A session record used to capture where the session **started**
(`initialChangedPaths`, `initialDigests`) and nothing about where it **ended**.
`scope-check` therefore compared a closed session's boundary against the
**live** working tree, so an edit made afterwards by a different authorised
session was attributed to it.

That produced three false failures in a single pass:
`SPEC-0003/ASES-0001` was blamed for a file `ASES-0002` created, and
`ASES-0003` and `SPEC-0002/ASES-0008` were both blamed for an edit `ASES-0004`
made under an approved change record. **Every one of those sessions passed its
scope check when it ran** (`SPEC-0003/CONV-009`, remediated under
`SPEC-0002/CHG-008`).

`close-session` now records `finalChangedPaths` and `finalDigests`, and
evaluation branches on the session's status:

| Session state | Judged against |
|---|---|
| `READY`, `IN_PROGRESS` | the live working tree — **unchanged** |
| terminal, with end-state evidence | its own recorded end state |
| terminal, without it | nothing; `SDD-V063` reports the limitation |

The third row is the one that matters for existing records. Every session
closed before this change lacks the evidence, so rather than guess, evaluation
attributes **nothing** to it and says why. A documented limited result is
worth more than an invented one.

The evidence is written once. Re-running `close-session` on a record that
already has it does not refresh it, so a closed session cannot silently absorb
later work.

**Not covered:** gate 1 at R4 and R5, which requires Product Owner **and**
Solution Architect. That remains unenforced by the validator, and is named
here so nobody reads the R3 rule as covering it.

## What is deliberately not a rule

The validator does not judge whether a plan is sound, a threat model
sufficient, a test meaningful or a requirement well written. Those are review
work. A tool that scored them would be trusted for a judgement it cannot make.
See `docs/sdd/ENFORCEMENT_STANDARD.md`.

## Authority / References

- `AGENTS.md`; `docs/RISK_CLASSIFICATION.md`
- `docs/sdd/SPEC_LIFECYCLE.md`, `HUMAN_APPROVAL_GATES.md`,
  `IDENTIFIER_STANDARD.md`, `TRACEABILITY_STANDARD.md`, `MACHINE_CONTRACT.md`
- `docs/sdd/ENFORCEMENT_STANDARD.md` — severity governance and transition
- `tools/sdd/rules/rules.mjs` — machine-side catalogue
- `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_SESSION_STANDARD.md`,
  `AGENT_ROLE_GATE_MATRIX.md` — the agent rules in context
- `specs/SPEC-0001-sdd-verification-enforcement/` — introduced `SDD-V001` to
  `SDD-V041`
- `specs/SPEC-0002-agent-integration-controlled-execution/` — introduced
  `SDD-V042` to `SDD-V058`, and `SDD-V059` to `SDD-V060` under `CHG-005`
