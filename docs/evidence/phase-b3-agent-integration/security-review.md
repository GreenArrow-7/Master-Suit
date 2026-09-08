# Security review

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07
**Reviewer:** AI, Security Reviewer role. **This is not an Application
Security risk acceptance.** No human security approval exists for this phase,
and the gate remains unresolved.

## Method

Read `tools/sdd/lib/agent.mjs` and the extended `tools/sdd/cli.mjs` line by
line, checked each declared control against the code that implements it, and
ran the negative fixtures that exercise it. Where a control is documentary
rather than technical, that is said rather than glossed.

## Threats and controls

| Threat | Control | Implemented | Verified by |
|---|---|---|---|
| `TH-001` scope self-expansion | `CTRL-001` scope comes from the task, checked against the diff | yes | `UT-115`, `UT-128`, `UT-131` |
| `TH-002` traversal or symlink escape | `CTRL-002` path safety with named refusal reasons | yes | `UT-126`, `UT-142` |
| `TH-003` forged actor type | `CTRL-003` AI cannot satisfy a human gate | yes | `UT-123` |
| `TH-004` drift resolved by overwriting | `CTRL-004` drift reported, never repaired | yes | `UT-122` |
| `TH-005` command injection through a git ref | `CTRL-005` fixed argument array, no shell, ref screening | yes | `UT-144` |
| `TH-006` dangling references in records | `CTRL-006` references resolved against real artefacts | yes | `UT-124`, `UT-125` |
| `TH-007` correlated blind spots | `CTRL-007` **documentary only** | stated, not solved | documentation review |

`CTRL-007` is not a technical control and is not presented as one. The
limitation is stated in `docs/sdd/AGENT_ROLE_MODEL.md`, in
`separation-of-duty-audit.md`, in `AGENTS.md` and in `known-limitations.md`.

## Untrusted input

Every agent record is treated as untrusted (`SEC-001`).

| Property | Evidence |
|---|---|
| No `eval` | scan of `tools/sdd/` returns one match, inside the validator test that *asserts* the absence |
| No `new Function` | same scan |
| No dynamic `require` or `import` of repository content | scan returns nothing |
| No shell | both process spawn sites use a fixed argument array with the shell disabled |
| Size bound | 128 KiB per record |
| Type check | non-object JSON refused (`UT-146`) |
| Regular files only | symbolic links and directories refused before reading |

A record that fails any of these produces a finding naming the reason. It is
never silently skipped, and a record that cannot be read is never treated as
an empty one. That distinction is what stops a malformed file reading as a
clean result.

## Filesystem writes

The entire control plane has exactly **one** write site: `writeSession`,
reached only from `agent create-session`, and only when preflight produced no
error. Everything else reads.

`REG-101` asserts the on-disk fixture is byte-identical after every read
command. `UT-131` asserts the record count is unchanged after a failing
`create-session`.

There is no command that edits a governance artefact. `SPEC-0002/CL-004`
records the reason: a tool that could repair a specification to satisfy its
own rules would make the rules advisory.

## Secrets

No secret is read, written, logged or referenced. The schemas provide no field
for command output, and `SEC-006` states why: a repository artefact that
copies logs will eventually copy a credential.

No `.env` file was opened during this phase. The documentation secret scan is
recorded in `secret-scan-result.md`.

## Privilege

The control plane has no database client, no network client, no credential and
no deployment capability. Its highest privilege is running read-only git
commands in the repository it was pointed at.

## Findings

No new security defect was identified in the B3 code. Two observations, both
already recorded as accepted limitations rather than defects:

1. **Actor identity is a self-declared label.** `actorId` is opaque text with
   no cryptographic binding. Separation of duty therefore proves two records
   differ, not that two parties exist. Recorded as `SEC-005` / `TH-007`.
2. **Approval records prove presence, not authenticity.** Carried forward from
   B2 unchanged. Nothing in B3 improves it, and nothing in B3 depends on it
   having been improved.

## Verdict

The declared controls are present and exercised. `CTRL-007` is documentary and
labelled as such.

**This review does not accept residual risk.** Application Security has not
reviewed this phase, and the security gate on `SPEC-0002` is `UNRESOLVED`.
