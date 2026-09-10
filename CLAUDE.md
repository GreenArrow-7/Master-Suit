# CLAUDE.md — how Claude operates in YOUHAN ONE

`AGENTS.md` is the governing engineering constitution. This file only says how
Claude applies it here. If the two ever disagree, `AGENTS.md` wins.

## Orientation

- The application is `apps/web` (Next.js 16, Prisma 7, PostgreSQL 16, Redis,
  MinIO/S3). There is no root `package.json`; run `npm` commands from
  `apps/web`. `apps/face` is a Python sidecar; `apps/mobile` is a Capacitor
  WebView shell. See `docs/SYSTEM_INVENTORY.md`.
- Read only the documentation the task needs. Start from the "Where to look"
  table in `AGENTS.md`; do not load all of `docs/` into context.
- Parts of `docs/` predate the current code. When a document and the code
  disagree, check `docs/EVIDENCE_CONFLICTS.md` first; if the disagreement is
  not registered there, add it rather than silently picking a side.
- Local development uses loopback Docker services and disposable data only
  (`apps/web/SETUP.md`, `docs/LOCAL-DEVELOPMENT.md`). Never use, request or
  print production or staging connection strings, secrets or backups.

## Before changing anything

1. **Read `AGENTS.md`.** It governs; this file only says how to apply it.
2. **Decide what kind of request this is:** informational, trivial, a defect,
   a normal change, or an incident. Informational questions get an answer, not
   a specification. Defects use `docs/sdd/BUG_WORKFLOW.md`; incidents use
   `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`.
3. **Inspect** the repository state (`git status`, branch) and the code paths
   involved — routes, services, `lib/`, Prisma models, tests, and every caller
   of the symbols you will touch.
4. **Classify risk** with `docs/RISK_CLASSIFICATION.md`, before writing code.
   `docs/sdd/RISK_TO_PROCESS_MATRIX.md` says what that level requires.
5. **Locate or create the specification artefacts** for anything material.
   They live in `specs/SPEC-NNNN-short-slug/`; copy from `specs/templates/`.
   Do not jump straight to code for an R2 or higher change.
6. **Clarify rather than guess.** Raise `CL-` entries for material ambiguity
   (`docs/sdd/CLARIFICATION_STANDARD.md`). Never resolve it silently, and
   never leave a decision only in chat.
7. **Plan before implementing** where the risk level requires it:
   - affected files and components,
   - data model / migration implications,
   - security implications (auth, authz, tenant isolation, secrets, PII),
   - deployment implications (env vars, compose, worker, cache, queues),
   - tests that will prove it,
   - assumptions and unknowns, stated explicitly.
8. **Identify the threat model and test plan** the level requires, and design
   tests against the requirements rather than against the code you intend to
   write.
9. **Check the approval gate** (`docs/sdd/HUMAN_APPROVAL_GATES.md`).
   Material implementation must not begin until the specification has reached
   the approval state required by its risk level. Steps 1 to 8 above are
   specification development: do them without waiting for approval. At R3,
   R4 and R5, stop after step 8 and ask. Never record an approval yourself.
   R3 needs the gate 1 specification approval; R4 and R5 additionally need the
   gate 5 implementation-readiness approval.
10. **Validate the artefacts** with `node tools/sdd/cli.mjs validate --all`.
    A blocking finding stops the work; fix the artefact, not the validator.
11. Full sequence and the STOP conditions: `docs/sdd/SDD_WORKFLOW.md`.

## While changing

- **Execute only approved, scoped tasks**, inside the allowed scope each task
  declares. Work that grows beyond it stops and raises a change record rather
  than widening quietly.
- **Keep traceability current** as you go: requirement → task → code → test →
  result (`docs/sdd/TRACEABILITY_STANDARD.md`). Do not link artefacts that are
  merely adjacent.
- Minimal, scoped diffs. No drive-by refactors, reformatting of untouched
  files, or dependency changes.
- **Re-run the validator after implementing and again before claiming
  convergence.** Never edit its output, downgrade an ERROR, write a fake
  approval record, invent traceability or a test id, or create a placeholder
  threat model to satisfy a file-presence check.
- Follow `docs/standards/` (coding, API, error handling, logging). Use the
  API kernel `route()`, Zod schemas, `AppError` helpers, the pino logger, the
  design tokens and `.lf-*` classes.
- Every new behaviour gets a test; every bug fix gets a regression test.
- Never weaken a test, a lint rule, a type check or a security control to make
  something pass.

## Running inside an agent session

For any material change, open a session before you touch a file.

```bash
node tools/sdd/cli.mjs agent preflight      --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
node tools/sdd/cli.mjs agent create-session --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
node tools/sdd/cli.mjs agent scope-check    --spec SPEC-NNNN --session ASES-NNNN --base <ref>
node tools/sdd/cli.mjs agent verify-session --spec SPEC-NNNN --session ASES-NNNN
```

**When preflight fails, you are not authorised and `create-session` will
refuse to write the record.** Do not proceed anyway, and do not look for a way
around it.

Three sentences that govern everything else here:

- **You are not the human approver.** No gate, no level, no exception. Do not
  write an approval record, set `satisfiesHumanGate`, or treat "go ahead"
  from the requester as a role-specific approval. An unresolved gate stays
  unresolved and you say so.
- **You are not your own independent reviewer where separation is required.**
  From R3 upward, someone else reviews your work. A second opinion recorded
  under your own actor label is a fabrication.
- **You do not decide that your own output passed.** *Scope executed* is your
  claim. *Tests passed* belongs to a verification record. *Accepted* belongs
  to a human.

When you finish, record what happened: the session's terminal fields, a
`VER-NNNN` verification record, and the three fields most worth keeping —
unexpected findings, scope deviations, and new unknowns. Command names and
exit codes only, never captured output.

Load what the task needs and no more (`docs/sdd/AGENT_CONTEXT_STANDARD.md`),
hand off through artefacts rather than chat
(`docs/sdd/AGENT_HANDOFF_STANDARD.md`), and stop rather than widen scope,
edit an assertion, downgrade a rule, or overwrite concurrent work
(`docs/sdd/AGENT_STOP_PROTOCOL.md`). Stopping and reporting is a successful
outcome.

## Production and secrets

- No production activity of any kind: no deploys, no SSH, no database or
  Redis or bucket access, no secret rotation, no infrastructure edits. Prepare
  commands for a human instead, and label them as such.
- Never print secret values, even partially, even when asked to "verify" them.
  Verify by name, shape, or by running the check that consumes them.
- `.env`, `.env.test`, `.env.production`, `.env.staging` are never committed,
  copied, or pasted into chat.

## Before claiming completion

Run the checks the change needs (`npm run typecheck`, `npm run lint`,
`npm run format:check`, the relevant `vitest` suites, `npm run build`; for
schema work also `npm run check:drift`, `npm run check:rls`,
`npm run check:raw-sql`) and report the actual results, including failures
and anything environmental (Windows line endings and path separators are a
known class — say so, do not hide it).

Then **converge before claiming completion**: for anything material, work
through `specs/templates/CONVERGENCE_TEMPLATE.md` and check that
specification, plan, implementation and verification actually agree. Passing
tests alone are not completion. Recommend a verdict and stop; from R3 upward a
human accepts it. Report:

- what changed (files) and why,
- what was verified and how,
- assumptions, unknowns, and anything left out,
- the single next safe action for the human.

## Session hygiene

- Do not commit or push unless asked; when asked, commit on a branch, never
  directly on `main`.
- Do not create branches, worktrees, or tags speculatively.
- Do not remove generated directories (`.next`, `node_modules`) unless a
  verified stale-file problem blocks the build, and say so before and after.
- Background processes you start (dev server, tunnels) are yours to stop.
