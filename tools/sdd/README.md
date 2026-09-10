# SDD validator

Deterministic structural validation of Spec-Driven Development artefacts.
Introduced by Phase B2, specified in
`specs/SPEC-0001-sdd-verification-enforcement/`.

## Usage

```bash
node tools/sdd/cli.mjs validate --all
node tools/sdd/cli.mjs validate --spec SPEC-0001
node tools/sdd/cli.mjs validate --all --format json
node tools/sdd/cli.mjs validate --all --strict          # warnings become errors
node tools/sdd/cli.mjs validate --changed --base main   # change association
node tools/sdd/cli.mjs rules                            # the rule catalogue
```

Exit codes: **0** no ERROR findings, **1** validation failure, **2** validator
or configuration failure. A tooling failure is never reported as a pass.

## Tests

```bash
node --test tools/sdd/tests/
```

No dependency is required for either the validator or its tests. The Node
standard library and the built-in test runner are all that is used.

## Layout

```text
tools/sdd/
├── cli.mjs              argument handling, output, exit codes
├── rules/rules.mjs      rule catalogue: id, severity, title
├── lib/
│   ├── discover.mjs     spec discovery, config, safe path resolution
│   ├── manifest.mjs     sdd.json loading and record shapes
│   ├── markdown.mjs     line-oriented artefact parsing
│   ├── lifecycle.mjs    states, transitions, artefact requirements by risk
│   ├── approvals.mjs    approval gates and actor type
│   ├── traceability.mjs requirement, test, task and convergence extraction
│   ├── diff.mjs         change association against a git range
│   └── validate.mjs     rule engine
└── tests/
    ├── validator.test.mjs
    └── fixtures/        synthetic valid and invalid specifications
```

## Design constraints

- **Node standard library only.** No dependency is added to any manifest.
- **Read-only.** The validator never creates, modifies or deletes a repository
  file.
- **Deterministic.** Same inputs, same findings, same order, no timestamps.
- **Untrusted input.** Artefacts are parsed as hostile data: no `eval`, no
  `Function`, no dynamic import of repository content, no shell. Paths are
  contained within the specification directory and symbolic links are not
  followed. Patterns are anchored, bounded and applied line by line.
- **Structure, not judgement.** It checks that an R4 specification has a threat
  model. It does not judge whether the threat model is good. That is review
  work.

## What it cannot prove

It confirms that a structured approval record exists naming a human actor
type. It cannot confirm a human made the decision, because anyone who can
commit can write that record. See `docs/sdd/MACHINE_CONTRACT.md` and
`specs/SPEC-0001-sdd-verification-enforcement/threat-model.md` `TH-005`.

## Documentation

| Topic | Document |
|---|---|
| The metadata contract | `docs/sdd/MACHINE_CONTRACT.md` |
| Rule identifiers and intent | `docs/sdd/VALIDATION_RULES.md` |
| What blocks, what advises, how enforcement tightens | `docs/sdd/ENFORCEMENT_STANDARD.md` |
| Exceptions | `docs/sdd/VALIDATION_EXCEPTIONS.md` |
| CI integration, and why it is not applied yet | `docs/sdd/CI_ENFORCEMENT.md` |
| The process being validated | `docs/sdd/SDD_WORKFLOW.md` |
