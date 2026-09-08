# Agent Execution Record

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`). What an implementation session records when it finishes.

## Fields

```text
Started from commit:
Role:
Task IDs:
Files changed:
Tests requested:
Tests run:
Test results:
Unexpected findings:
Scope deviations:
New unknowns:
New evidence conflicts:
Result:
```

Machine form: the session record's terminal fields, plus a `VER-NNNN`
verification record for the test detail. See
`docs/sdd/AGENT_SESSION_STANDARD.md`.

## Result values

| Result | Meaning |
|---|---|
| `COMPLETE` | The assigned execution scope was carried out in full |
| `PARTIAL` | Some of the scope was carried out; the remainder is named |
| `BLOCKED` | Work stopped at a condition in `docs/sdd/AGENT_STOP_PROTOCOL.md` |
| `FAILED` | The work was attempted and did not succeed |

**`COMPLETE` does not mean convergence passed.** It means the assigned scope
was executed and nothing more. A reader who treats it as acceptance has
misread it, which is why the word "accepted" appears nowhere in this
vocabulary.

`SDD-V057` refuses `COMPLETE` while a required test has no recorded
verification.

## The three fields that matter most

Everything above is bookkeeping except these, which are where an honest agent
differs from a plausible one.

**Unexpected findings.** Anything noticed that nobody asked about: a latent
bug, a stale comment that is now wrong, a second caller that will break.
Recording it costs a line. Not recording it means the next person rediscovers
it during an incident.

**Scope deviations.** Any file touched outside the declared scope, and why.
The scope checker will find it anyway; recording it first is the difference
between a disclosure and a discovery.

**New unknowns.** Anything the session could not establish. An agent that
records no unknowns after a substantial change is usually not looking.

## What must never appear

- Command output beyond exit codes and test identifiers (`SEC-006`).
- Any credential, token or connection string.
- A claim of human approval. An execution record has no authority to record
  one, and `SDD-V053` rejects an AI actor on a human-required gate.
- A test identifier that is not in the test plan (`SDD-V054`).

## Authority / References

- `docs/sdd/AGENT_SESSION_STANDARD.md`, `AGENT_ROLE_MODEL.md`,
  `AGENT_STOP_PROTOCOL.md`
- `docs/sdd/VALIDATION_RULES.md`
- `specs/templates/VERIFICATION_RECORD_TEMPLATE.json`
