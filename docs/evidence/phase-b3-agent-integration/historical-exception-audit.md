# Historical exception audit — EXC-001

**Date:** 2026-09-08 · **Rule:** `SDD-V060` · **Specification:** `SPEC-0002`
**Approving role:** Solution Architect · **Status:** APPROVED

## The sequence, in order

```text
historical deviation      SPEC-0002 entered APPROVED_FOR_IMPLEMENTATION
                          on 2026-09-07, before its specification was approved
        ↓
policy clarified          D2 resolved EVC-015 in favour of Option A:
                          mandatory R3 approval by Product Owner or SA
        ↓
approval later recorded   D1, Product Owner, 2026-09-08 — genuinely late
        ↓
machine rule added        TASK-015 introduced SDD-V059 and SDD-V060
        ↓
rule catches its author   SDD-V060 fired on SPEC-0002; CONV-011 raised;
                          validate --all returned 1 error; preflight blocked
        ↓
historical exception      EXC-001, approved by the Solution Architect
        ↓
recurrence prevented      SDD-V060 stays fully active everywhere else
```

Both dates remain exactly as they were. **Nothing was backdated and no
lifecycle history was rewritten.**

## Why the exception is legitimate

The finding is true and the fact is immutable. There were four ways it could
have gone away, and three of them were forbidden:

| Route | Verdict |
|---|---|
| Edit the approval date | falsification |
| Edit the `statusHistory` date | falsification |
| Soften or narrow `SDD-V060` | defeats the rule this phase built |
| A scoped, human-approved exception | **the sanctioned route, taken** |

`docs/sdd/VALIDATION_EXCEPTIONS.md` exists for exactly this shape: a rule that
cannot be satisfied, exempted narrowly, with the reason written down and a
human name against it.

## How it is scoped

| Dimension | Bound |
|---|---|
| Rule | `SDD-V060` only |
| Specification | `SPEC-0002` only |
| Condition | the single historical implementation transition that occurred before `EVC-015` was resolved and before `SDD-V060` existed |
| Precedent | **none.** Non-precedential by explicit statement |
| Future R3 work | unaffected; a late approval still fails |
| Other rules | unaffected, including `SDD-V059` |
| Release gates | untouched; an exception can never waive one |

**Expiry is a condition, not a date.** Rule 2 of the standard permits either.
A calendar expiry would be dishonest here: the exempted fact is a historical
date that will never change, so a future expiry would fail the repository for
something nobody could act on. The condition instead ends the exception if
`SPEC-0002` is superseded or cancelled, or if either date is ever amended —
because then the fact being exempted has changed.

**No standards mismatch was found.** The standard anticipated this case.

## The mechanism is generic

There is no `if (specId === "SPEC-0002")` anywhere. `UT-045` asserts that
`tools/sdd/lib/exceptions.mjs` contains no hard-coded specification or
exception identifier at all.

An exception must be a well-formed record naming exactly one rule and one
specification, `APPROVED`, `actorType: "human"`, approved by a Solution
Architect or Application Security, with an effective date, an end, a reason
and a compensating control. Anything else suppresses nothing.

## The condition is still reported

```text
INFO    SDD-V060  SPEC-0002 · sdd.json
        EXCEPTED under EXC-001: Specification approval is dated after the
        specification entered APPROVED_FOR_IMPLEMENTATION; the gate was
        crossed before it was approved
```

Downgraded to `INFO`, never deleted. The rule id, the specification and the
original message all survive, and the exception id is named. Anyone reading
the output sees both that the condition exists and why it is not blocking.

## Proof the rule survives for future work

| Test | Proves |
|---|---|
| `UT-044` | A synthetic R3 specification with a late approval and **no** exception still fails `SDD-V060` |
| `UT-037` | An exception naming a different rule does not suppress it |
| `UT-038` | An exception naming a different specification does not suppress it |
| `UT-043` | An exception to `SDD-V060` does not suppress `SDD-V059` |
| `UT-039` | `PROPOSED` and `WITHDRAWN` suppress nothing |
| `UT-042` | `EXPIRED` suppresses nothing |
| `UT-041` | Product Owner, QA, Intern and an empty role cannot approve one |
| `UT-045` | An `ai` actor cannot approve one |
| `UT-040` | Eight malformed shapes each fail closed and are reported as `SDD-V061` |
| `UT-036` | A valid exception downgrades and stays visible |

None of these uses `SPEC-0002`. A mechanism proven only on the case it was
built for proves nothing.

## Where the deviation remains visible

Five places, none of which the exception touches: `CONV-004`, `CONV-011`, the
manifest `statusHistory` note at the point of transition, `spec.md`'s approval
section, and the `INFO` finding on every validator run.

## What this exception does not do

It does not weaken `SDD-V060` globally, apply to another specification,
authorise future late approval, permit AI self-approval, satisfy any
production or release gate, alter the `D2` policy, alter `D1`'s true date, or
hide `CONV-004`.
