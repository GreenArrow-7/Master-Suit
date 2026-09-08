# Agent Handoff Standard

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`).

## The rule

When work moves between agents or sessions, it moves through **artefacts**,
not conversation memory.

A receiving agent must not treat *"the previous session said…"* as engineering
evidence. Chat history may supply context and orientation. Only repository
artefacts carry authority.

The reason is not tidiness. A claim that exists only in a transcript cannot be
reviewed, cannot be validated, cannot be found six months later, and cannot be
distinguished from a hallucination.

## The chain

```text
PLANNER
   ↓ plan.md, with AD- decisions
IMPLEMENTER
   ↓ TASK-NNN + ASES-NNNN session record
TESTER
   ↓ test-plan.md + VER-NNNN verification record
SECURITY REVIEWER
   ↓ threat-model.md + the diff + REV-NNNN review record
CONVERGENCE REVIEWER
   ↓ every authoritative artefact + convergence.md
HUMAN
   ↓ acceptance, recorded
```

Each arrow is a file. If the arrow is only a sentence in a chat window, the
handoff did not happen.

## What a receiving agent does

1. Read the artefact it was handed, not the summary of it.
2. Verify the handoff resolves: the session, task and test identifiers it
   names must exist. `SDD-V055` catches a review citing a session that does
   not exist; `SDD-V054` catches a verification citing a test that is not in
   the test plan.
3. Run the validator and, for an execution role, preflight. A handoff does not
   inherit authorisation; each session earns its own.
4. Load only what the task needs (`docs/sdd/AGENT_CONTEXT_STANDARD.md`).
5. Where the incoming artefact and the code disagree, stop rather than pick a
   side (`docs/sdd/AGENT_STOP_PROTOCOL.md`).

## What a handing-off agent does

Write the artefact before ending the session. An unrecorded finding, a scope
deviation left unmentioned, or an unknown carried only in the agent's own
reasoning is lost at the session boundary. `docs/sdd/AGENT_EXECUTION_RECORD.md`
lists the three fields most often skipped and most worth keeping.

## Handoffs that cross a separation boundary

At R3 and above, the implementer hands off to a reviewer that must not be
itself. The receiving session records a different `actorId`; `SDD-V051`
rejects a review whose actor matches the executing session's.

This is a structural check on a recorded label. It proves the records differ.
It does not prove the reviewer thought independently — see
`docs/sdd/AGENT_ROLE_MODEL.md`.

## Authority / References

- `docs/sdd/AGENT_SESSION_STANDARD.md`, `AGENT_ROLE_MODEL.md`,
  `AGENT_CONTEXT_STANDARD.md`, `AGENT_STOP_PROTOCOL.md`
- `docs/sdd/ARTIFACT_AUTHORITY.md` — nothing that shaped the work lives only
  in chat
- `docs/sdd/VALIDATION_RULES.md` — `SDD-V051`, `SDD-V054`, `SDD-V055`
