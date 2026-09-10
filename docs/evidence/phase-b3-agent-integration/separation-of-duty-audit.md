# Separation of duty audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## The rule

From R3 upward, the implementer is not the sole reviewer of its own work. At
R4 and R5 the security review is additionally distinct from implementation.

## What is checked

`reviewFindings` compares two things and raises `SDD-V051` if either matches:

| Compared | Rejected when |
|---|---|
| The review actor against the reviewed session actor | equal and non-null |
| The reviewing session against the reviewed session | equal |

`UT-120` covers the first by setting the review actor to the executing
session actor. `UT-121` covers the second by pointing the reviewing session at
the reviewed session.

A review that cites a session which does not exist is `SDD-V055` (`UT-125`),
so a reviewer cannot manufacture independence by referencing nothing.

## The human gate is separate and absolute

`satisfiesHumanGate` defaults to false. Setting it true while the actor type
is `ai` raises `SDD-V053` (`UT-123`). No AI review discharges a gate that
requires a human, at any risk level, in any circumstance.

The schema documents this on the field itself: an agent must never set it.

## What this does not prove

This is the most important paragraph in the audit.

`SDD-V051` compares **recorded labels**. It proves two records carry different
actor identifiers. It does not prove two independent minds examined the work.
Two sessions of the same model, given the same context, share the same blind
spots, and a second session is not a second reviewer in the sense a human
reviewer is.

The control is therefore real but bounded: it prevents one session
self-certifying, and it does not manufacture independence.
`docs/sdd/AGENT_ROLE_MODEL.md` states this in the standard itself rather than
only here, and `SEC-005`, `TH-007` and `CTRL-007` in `SPEC-0002` record it as
an accepted residual limitation. It is carried into `known-limitations.md`.

**Result:** separation is enforced structurally, and its limits are stated
rather than implied.
