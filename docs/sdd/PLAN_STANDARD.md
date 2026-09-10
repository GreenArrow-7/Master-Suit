# Plan Standard

`NORMATIVE — engineering process requirement.`

The specification answers what and why. The plan answers **how**, and only
how. A plan that changes what the system must do has exceeded its authority
(`docs/sdd/ARTIFACT_AUTHORITY.md`).

## Mandatory content

Depth scales with risk (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`). Sections that
do not apply say "Not applicable" with a reason.

1. **Affected architecture** — which layers and modules, named against
   `docs/architecture/`.
2. **Existing patterns to reuse** — the kernel `route()`, `Ctx`-taking
   services, `visibilityWhere`, `assertPermission`, `AppError` helpers, the
   pino logger, `enqueue`, the design tokens. Reuse is the default; a new
   pattern needs an `AD-` that says why the existing one does not fit.
3. **Files and components likely affected** — a list, not a guess. Produced by
   reading the code, including every caller of the symbols involved.
4. **Data model impact** — models, columns, indexes, and whether a migration
   is additive, backfilling or destructive.
5. **API impact** — new or changed routes, request and response shapes,
   status codes, pagination, and whether the change is additive under the v1
   contract.
6. **Frontend impact** — pages, components, navigation, and whether the
   change is server-rendered or client.
7. **Backend impact** — services, workers, queues, schedulers.
8. **Integrations** — outbound calls, webhooks, credentials, failure and
   retry behaviour.
9. **Authentication impact.**
10. **Authorization impact** — module, action and scope; new permissions;
    field rules.
11. **Tenant-isolation impact** — how the change keeps the three layers
    intact: application filter, Prisma tenant guard, row-level security.
12. **Database and migration impact** — lock behaviour, runtime at production
    volume, RLS policy coverage for any new tenant table, backfill strategy.
13. **Compatibility** — existing rows, existing sessions, queued jobs already
    in Redis, API consumers, mobile shell.
14. **Dependencies** — none by default. A new dependency requires the
    justification `AGENTS.md` §6 demands, inside an `AD-`.
15. **Concurrency and idempotency.**
16. **Error behaviour** — which `AppError`, which status, what the caller sees.
17. **Logging and observability** — what is logged, what is redacted, what
    metric or alert changes.
18. **Security considerations** — the summary; the detail lives in the threat
    model where one is required.
19. **Test strategy** — the shape; the detail lives in the test plan.
20. **Deployment implications** — environment variables, compose, worker
    restart, cache or queue compatibility, ordering against the migration.
21. **Rollback and reversibility** — how to undo it, and what cannot be undone.
    Migrations have no down path in this repository; say what that means here.
22. **Operational impact** — runbook changes, new alerts, new failure modes an
    operator will meet at 3am.
23. **Risks** — technical risks with their mitigations, and any open `EVC`
    that touches this area.
24. **Alternatives considered** — what was rejected and why.
25. **Technical decisions** — the `AD-` list.

## Technical decisions

```text
AD-001

Decision:
Reason:
Alternatives:
Trade-offs:
Requirements supported:
```

**Mandatory rule:** every material implementation decision traces to one or
more requirements, or to an explicit engineering constraint recorded in the
plan. A decision that serves neither is unjustified scope and is rejected in
review.

An engineering constraint is a real, citable limitation — a framework
behaviour, an existing contract, a platform guarantee, a constitutional rule.
"It seemed cleaner" is not a constraint.

## What a plan must not do

- Add, remove or reinterpret a requirement. Raise a clarification or a change
  record instead.
- Introduce scope the specification does not ask for, including refactors,
  renames, formatting sweeps and dependency upgrades.
- Decide that a requirement is impossible and quietly plan around it.
- Assert current behaviour it did not verify. Cite the file, or mark it
  unknown.

## Brownfield discipline

Before planning a change to existing behaviour, read the current
implementation and every caller. The plan records what exists today, with
evidence, and what will differ. Where the plan's reading of current behaviour
contradicts existing documentation, that is an evidence conflict: register it
rather than picking a side.

## Authority / References

- `AGENTS.md` §1, §3, §4, §6
- `docs/sdd/ARTIFACT_AUTHORITY.md` — the plan may not override the spec
- `docs/sdd/RISK_TO_PROCESS_MATRIX.md` — required depth
- `docs/architecture/`, `docs/standards/` — the patterns to reuse
- `docs/security/AUTHORIZATION.md`, `docs/architecture/DATABASE.md` —
  isolation and permission model to preserve
- `docs/operations/ROLLBACK.md` — what rollback can and cannot do here
- `specs/templates/PLAN_TEMPLATE.md`
