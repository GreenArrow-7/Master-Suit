# CI integration audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## Decision

**`.github/workflows/sdd-validate.yml` was not modified during B3.**

This is a deliberate refusal, recorded in `SPEC-0002/CL-005`, not an omission.

## Why

A workflow file is infrastructure. Changing it is R5, and R5 requires DevOps
infrastructure approval.

The phase brief is explicit that proceeding to B3 constitutes acceptance of
the B2 engineering result only, and specifically **not** DevOps infrastructure
approval. No such approval exists. `AGENTS.md` forbids an agent from granting
one, and the gate stays unresolved.

The contrast with `SPEC-0001/CHG-001` is instructive and was checked before
deciding. There, the requester gave an explicit written instruction to add the
CI check if it was safe, and a change record was raised against that
instruction. Here, the equivalent instruction was withheld. The same agent
reaching opposite conclusions from different authorisation is the control
working, not inconsistency.

## What this leaves open

**The agent test suite does not run in continuous integration.** The workflow
runs `node --test tools/sdd/tests/validator.test.mjs` only. Adding
`tools/sdd/tests/agent.test.mjs` requires the approval that does not exist.

Partial mitigation, stated precisely so it is not over-read: the workflow's
second step, `validate --all`, uses the shared rule catalogue, so the new
`SDD-V042` to `SDD-V058` rules **are** applied to real repository artefacts
whenever the workflow runs. What does not run is the 36-test suite that proves
those rules behave correctly on synthetic input.

So CI would catch an artefact that violates a new rule. It would not catch a
regression in the rule itself.

## Carried forward from B2, still open

1. The workflow has **never executed on GitHub**. It was authored in B2 and
   the repository has not been pushed. Whether it passes on a Linux runner is
   `UNKNOWN — requires verification`, not assumed.
2. Branch protection and required status checks remain **externally
   unverified**. Whether the check is enforced on merge cannot be established
   from inside the repository.
3. The `gh` command line is unauthenticated in this environment, so no run
   history could be read. This was not worked around by guessing.

## The single next action for a human

Decide whether to add the agent test suite to the workflow. If yes, it is one
step, mirroring the existing one:

```yaml
      - name: Agent control-plane tests
        run: node --test tools/sdd/tests/agent.test.mjs
```

The directory form of the runner argument must not be used. It fails with a
module resolution error on Windows, which is why every reference in this
repository names the file explicitly.

That change is R5. It needs DevOps approval before anyone applies it.
