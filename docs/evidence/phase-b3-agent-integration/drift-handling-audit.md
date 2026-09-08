# Drift handling audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## What drift means here

The repository changed underneath a session: the head commit moved, or files
became dirty that were not dirty when the session started and are not in its
scope.

## Why it is a warning

`SDD-V052` is `WARNING`, and `UT-148` asserts that severity explicitly so a
future edit cannot quietly promote it.

Concurrent human work in the same tree is normal and legitimate. This
repository is a live example: 34 application files carry uncommitted redesign
work that predates every SDD phase. A rule that treated that as an error would
fail every session for the crime of someone else working.

## What the agent must not do about it

Report. Never revert, never overwrite, never stash, never reset.

`SPEC-0002/CL-003` records the decision. The finding text carries the
instruction into the output itself: *"Changed outside this session and outside
its scope; review rather than overwrite."*

`AGENTS.md` and `docs/sdd/AGENT_STOP_PROTOCOL.md` both list reverting
concurrent work among the things that must never happen instead of stopping.

## How pre-existing work is protected

A session records its initial changed paths at creation: every working-tree
path already dirty at that moment. Drift detection subtracts that set before
reporting, so pre-existing user work is never attributed to the agent and
never appears as something to clean up.

Combined with the scope check, this gives the property that matters on this
repository: an agent working under the process tooling cannot be led to touch,
blame, or tidy the uncommitted redesign in the application source.

## Observed

`UT-122` runs `driftFindings` against the real repository with a session
claiming a commit the repository has never been at. It asserts `SDD-V052` is
raised and that every finding returned carries severity `WARNING`.

Output is capped at 25 drifted paths so a large divergence produces a readable
report rather than a wall of text.

**Result:** drift is surfaced for human review, bounded, and never repaired by
the tool.
