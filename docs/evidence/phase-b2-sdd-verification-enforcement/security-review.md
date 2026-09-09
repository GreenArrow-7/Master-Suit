# Security review of the SDD validator

The validator parses repository content that any pull-request author can
control, and is intended to run in CI. Its input is treated as hostile.
Threat model: `specs/SPEC-0001-sdd-verification-enforcement/threat-model.md`.

## Review checklist

| # | Concern | Finding |
|---|---|---|
| 1 | Path traversal | **Mitigated.** `safeResolve` rejects absolute paths, null bytes, paths over 200 characters, and any path whose resolved form escapes the base directory. Every artefact path goes through it. `ST-001` confirms a `../../` path is reported as `SDD-V008` and the target is never read |
| 2 | Malicious filenames | **Mitigated.** Directory names must match `^SPEC-([0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$`. A non-matching directory is reported as `SDD-V001`, never traversed further. Dot-directories are skipped |
| 3 | Symbolic links | **Mitigated.** `lstatSync` is used rather than `statSync` wherever a link could redirect a read. A symlinked specification directory is skipped; a symlinked artefact fails `isPlainFile` and is reported as missing rather than followed |
| 4 | Arbitrary file reads | **Mitigated.** Reads are confined to the specs root plus `docs/EVIDENCE_CONFLICTS.md` and existence checks for referenced documents. `.env` files, application source and anything outside the repository are never opened (`DATA-002`) |
| 5 | Command injection | **Mitigated.** One `child_process` call exists, in `diff.mjs`. It uses `execFileSync` with a fixed argument array, `shell: false`, a 20-second timeout and a bounded buffer. The base reference is validated against `^[A-Za-z0-9._/-]{1,100}$` and refused if it starts with `-`, so an argument such as `--upload-pack=…` cannot be smuggled in. A test asserts exit 2 for that input |
| 6 | Shell interpolation | **Mitigated.** No shell is invoked anywhere. `ST-002` scans every module and fails on `eval`, `new Function`, `execSync`, `shell: true`, or `child_process` imported outside the diff module |
| 7 | JSON parser safety | **Mitigated.** `JSON.parse` only, on content bounded to 256 KB, wrapped so a parse failure becomes `SDD-V004` rather than a crash. A non-object top-level value is rejected. No prototype-pollution sink exists: parsed values are read, never merged into an object with `Object.assign` or spread onto a prototype |
| 8 | Regular-expression denial of service | **Mitigated.** All patterns are anchored where possible, use bounded quantifiers, and contain no nested quantifiers. Parsing is line-oriented and each line is truncated to 4,000 characters, so no pattern ever sees an unbounded string. `ST-003` parses a 25,000-character hostile line in single-digit milliseconds |
| 9 | Very large files | **Bounded.** Manifests over 256 KB are rejected. Markdown artefacts are read whole, so a very large artefact costs linear time and memory. Acceptable for repository content; noted as a residual |
| 10 | Invalid UTF-8 and malformed text | **Tolerated.** Files are read as UTF-8 with replacement characters; a byte-order mark is stripped; CRLF and LF are both handled. Malformed text produces findings, not crashes. Separately, the final scan found a stray NUL byte in the tool own test file, introduced when it was written; it was removed and `tools/` now verifies as free of control characters |
| 11 | Secrets in output | **Mitigated.** Findings carry a rule id, severity, specification, artefact path, a fixed message and a line number. Artefact content is never copied into a finding. `ST-004` places a synthetic canary in a fixture and asserts it does not appear in output |
| 12 | CI trust boundaries | **Reviewed and applied.** `.github/workflows/sdd-validate.yml` requests `permissions: contents: read` at workflow level, sets `persist-credentials: false` on checkout so no git credential is left in the runner, references no secret, declares no environment or service container, installs no dependency, and has a 10-minute timeout. It cannot deploy, reach production or staging, connect to a database or run a migration. It is a separate workflow, so it cannot alter `ci.yml` or `deploy.yml` |

## The limitation that cannot be engineered away

`TH-005`. The validator can confirm that an approval record exists, names a
gate, and carries `actorType: "human"`. It **cannot** confirm a human made the
decision. Anyone who can commit can write that record.

This is stated in `docs/sdd/MACHINE_CONTRACT.md`,
`docs/sdd/ENFORCEMENT_STANDARD.md`, `docs/sdd/HUMAN_APPROVAL_GATES.md` and
`tools/sdd/README.md`, in each case as a limitation rather than a footnote.
Real assurance comes from commit authorship, code review and branch
protection. Branch protection on this repository is
`UNKNOWN — requires runtime/infrastructure verification` (GAP-CI-01), so the
assurance chain is currently incomplete and the residual risk is accepted by
Application Security with that condition attached.

## What an attacker can still do

Honestly stated, because a security review that finds nothing is not a
security review:

1. **Write a false approval record.** Covered above. Mitigated by review, not
   by this tool.
2. **Write a plausible but empty threat model** to satisfy `SDD-V023`. The
   validator checks presence, not adequacy (`CL-002`). `AGENTS.md` now
   explicitly forbids creating placeholder artefacts to satisfy a
   file-presence rule, which is a rule an agent follows rather than a control
   the tool enforces.
3. **Consume time** with very large artefacts. Linear, bounded, and visible.
4. **Cause a false PASS by exploiting a rule gap.** The four rules without a
   dedicated negative fixture are the most likely place for such a gap, and
   they are recorded in `known-limitations.md`.

## Result

**No blocking security defect found.** One accepted residual risk, `TH-005`,
with a named owner and a stated condition for revisiting.

## Evidence Sources

E1: `tools/sdd/lib/*.mjs`, `tools/sdd/cli.mjs`, `tools/sdd/rules/rules.mjs`.
E2: `.github/workflows/sdd-validate.yml`.
E3: `ST-001` to `ST-004`, and the invalid-`--base` test.
E4: `specs/SPEC-0001-sdd-verification-enforcement/threat-model.md`,
`docs/PHASE_A_GAP_ANALYSIS.md` GAP-CI-01.
