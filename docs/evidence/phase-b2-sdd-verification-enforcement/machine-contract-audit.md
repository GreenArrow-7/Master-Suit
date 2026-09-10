# Machine contract audit

## What was created

| Artefact | Purpose |
|---|---|
| `docs/sdd/MACHINE_CONTRACT.md` | The contract: what `sdd.json` holds and what it must never hold |
| `docs/sdd/schemas/sdd-manifest.schema.json` | JSON Schema 2020-12, documentation and interoperability |
| `specs/templates/SDD_MANIFEST_TEMPLATE.json` | Blank manifest to copy |
| `sdd.config.json` | Repository-level validator settings |

## The authority split holds

| File | Authority | Verified |
|---|---|---|
| `spec.md` | Intended behaviour: requirements, acceptance criteria, scope | Yes |
| `sdd.json` | Process metadata: id, slug, kind, risk, status, artefact paths, history, approvals, reviews | Yes |

`sdd.json` contains no requirement, no acceptance criterion and no
behavioural statement. The schema forbids unknown top-level properties, so a
requirement cannot be smuggled in without failing validation.

Three facts appear in both files: identifier, risk and status. That
duplication is deliberate and is policed by `SDD-V011`, `SDD-V012` and
`SDD-V013`, each of which has a passing negative test. Drift becomes a
finding rather than a silent inconsistency.

## Schema and validator agree

The schema and the implementation were written from the same contract and
cross-checked field by field: `schemaVersion` const 1; `specId` pattern
`^SPEC-[0-9]{4}$`; `slug` lower-case hyphenated; `kind` one of change, bug,
emergency; `risk` R0–R5; `status` one of the fourteen lifecycle states; nine
artefact keys, each string or null; `statusHistory` entries with status and
ISO date; `approvals` with gate, role, actorType, decision, date;
`reviews` with type, role, actorType, decision, date; `evidenceConflicts` as
`EVC-NNN`.

The validator implements these checks directly rather than loading the schema
through a library, per `AD-002`. The schema is therefore documentation and an
interoperability contract, which is what `docs/sdd/MACHINE_CONTRACT.md` says
it is. A future divergence between the two is possible and is recorded as a
known limitation.

## R1 and R0

Every specification from R1 upward carries a manifest. R0 has no
specification directory at all, and `SDD-V039` fails a directory declaring
itself R0, with a passing negative test. This matches the single storage
model the B1 correction pass established.

## Evidence Sources

E1: `docs/sdd/MACHINE_CONTRACT.md`, `docs/sdd/schemas/sdd-manifest.schema.json`,
`tools/sdd/lib/manifest.mjs`, `tools/sdd/lib/validate.mjs`,
`specs/SPEC-0001-sdd-verification-enforcement/sdd.json`.
E3: the `SDD-V002`, `SDD-V005`, `SDD-V011`–`SDD-V013`, `SDD-V039` tests.
