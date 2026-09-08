# SPEC-NNNN — Technical plan

> Copy to `specs/SPEC-NNNN-short-slug/plan.md`.
> The plan answers **how**. It may not add, remove or reinterpret a
> requirement; if planning shows a requirement is wrong, raise `CL-` or `CHG-`.
> Rules: `docs/sdd/PLAN_STANDARD.md`. Depth: `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Author | functional role |
| Date | YYYY-MM-DD |

## Affected architecture

Which layers and modules, named against `docs/architecture/`.

## Existing patterns to reuse

Reuse is the default. Name the pattern and where it already lives. Introducing
a new pattern requires an `AD-` explaining why the existing one does not fit.

## Files and components likely affected

Produced by reading the code, including every caller of the symbols involved.

| Path | Change | Why |
|---|---|---|

## Data model impact

Models, columns, indexes. Migration type: none, additive, backfilling, or
destructive. Destructive or long-locking makes this R5.

## API impact

New or changed routes, request and response shapes, status codes, pagination.
State whether the change is additive under the v1 contract.

## Frontend impact

## Backend impact

Services, workers, queues, schedulers.

## Integrations

Outbound calls, webhooks, credentials, failure and retry behaviour.

## Authentication impact

## Authorization impact

Module, action and scope. New permissions. Field-level rules.

## Tenant-isolation impact

How the change keeps all three layers intact: application filter, Prisma
tenant guard, row-level security. If it touches none of them, say so.

## Database and migration impact

Lock behaviour, expected runtime at production volume, RLS policy coverage for
any new tenant table, backfill strategy.

## Compatibility

Existing rows, sessions, queued jobs already in Redis, API consumers, the
mobile WebView shell.

## Dependencies

None by default. A new dependency needs the justification `AGENTS.md` §6
requires, recorded as an `AD-`.

## Concurrency and idempotency

## Error behaviour

Which error type, which status, what the caller sees.

## Logging and observability

What is logged, what is redacted, which metric or alert changes.

## Security considerations

Summary. Detail belongs in `threat-model.md` where one is required.

## Test strategy

Shape only. Detail belongs in `test-plan.md`.

## Deployment implications

Environment variables, compose, worker restart, cache and queue
compatibility, ordering against any migration.

## Rollback and reversibility

How to undo it, and what cannot be undone. Note that database migrations here
have no down path (`docs/operations/ROLLBACK.md`).

## Operational impact

Runbook changes, new alerts, new failure modes an operator will meet at 3am.

## Risks

Technical risks and mitigations. Any open evidence conflict touching this area
(`docs/EVIDENCE_CONFLICTS.md`).

## Alternatives considered

What was rejected, and why.

## Technical decisions

> Every material decision traces to one or more requirements, or to an
> explicit engineering constraint. A decision serving neither is unjustified
> scope.

### AD-001

**Decision:**
**Reason:**
**Alternatives:**
**Trade-offs:**
**Requirements supported:** `FR-00x`, `SEC-00x` — or the engineering
constraint, cited.
