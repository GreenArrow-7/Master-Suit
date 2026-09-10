# SPEC-0007 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

Not mandatory at R3, and included because the work is security-sensitive in one
specific way: it points a destructive operation at a wider set of tables, and it
creates login identities that a stranger will watch being typed. The risk matrix
calls for a self-check at this level rather than an Application Security
approval; this document is that self-check, written so that a reviewer can
disagree with it.

Scope: the demo dataset, the three demonstration personas, and the seed and
reset operations. Extends `docs/THREAT-MODEL.md` rather than replacing it.

## Assets

| Asset | Why it matters here |
|---|---|
| Real customer and employee records in any non-demo workspace | The isolation this work must not weaken |
| The demo baseline | A prospect must see a coherent product, not a half-reset one |
| Demonstration credentials | Real logins, typed in front of an outsider |
| The reset operation | The only destructive capability this specification adds |
| Audit evidence | The account of what a demonstrator did |

## Actors

A demonstrator, hurried and non-technical. A prospect beside them, untrusted,
sometimes holding the keyboard. An operator running seed and reset. An engineer
adding a model six months from now. Anyone who learns a demonstration password.

## Trust boundaries

Browser to route handler to tenant guard to row-level security. The seed and
reset sit outside the request path entirely: they are operator tools run against
a database, gated by environment declarations rather than by a session.

## Threats and controls

- `TH-001` — A demonstration persona reads or writes another workspace's
  records.
  Controls: `CTRL-001`. Verified by `ST-001`, `ST-002`.

- `TH-002` — Another workspace's user reaches the demo workspace's records.
  Controls: `CTRL-001`. Verified by `ST-001`.

- `TH-003` — A demonstration persona reaches a module its role does not grant:
  the Sales persona opening HR data, or the HR persona opening Sales data.
  Controls: `CTRL-002`. Verified by `ST-003`, `ST-004`.

- `TH-004` — A demonstration persona reaches a route the navigation hides but
  the API does not protect.
  Controls: `CTRL-002`, which is enforced in the API kernel rather than the
  navigation. Verified by `ST-003`, asserted against route handlers.

- `TH-005` — A demonstration persona reaches the platform control plane.
  Controls: `CTRL-003`. Verified by `ST-005`.

- `TH-006` — The reset runs against a database that is not disposable.
  Controls: `CTRL-004`. Verified by `ST-006`, `ST-007`.

- `TH-007` — A future tenant-scoped model escapes the reset, leaving records
  behind that the next demonstration displays as if they were baseline.
  Controls: `CTRL-005`. Verified by `UT-007`.

- `TH-008` — A demonstration action sends a message to a real recipient: a
  follow-up email to a lead, an invitation to a colleague, a notification.
  Controls: `CTRL-006`, `CTRL-007`. Verified by `ST-008`.

- `TH-009` — An inbound integration callback reaches the demo workspace.
  Controls: `CTRL-007`. A callback resolves its workspace from a key held on an
  integration connection, and the demo workspace holds none. Verified by
  `ST-009`.

- `TH-010` — The dataset contains, or comes to contain, a real person's data.
  Controls: `CTRL-008`, `CTRL-009`. Verified by `UT-004`, `UT-005`, `UT-006`.

- `TH-011` — The dataset contains biometric or bank data, the two highest
  sensitivity classes in the HR module.
  Controls: `CTRL-008`. Verified by `UT-005`.

- `TH-012` — A demonstration credential becomes public.
  Controls: `CTRL-010`, `CTRL-011`. The blast radius of a fully successful
  abuse is synthetic data in one disposable workspace. Verified by `ST-010`.

- `TH-013` — A credential value is committed, printed into an evidence file, or
  written to a log.
  Controls: `CTRL-011`. Verified by `ST-011`.

- `TH-014` — A prospect performs a destructive action during a demonstration.
  Controls: `CTRL-002` bounds it to the persona's own grants — `sales_rep`
  holds no delete and no bulk update — and the reset restores the baseline in
  any case. Verified by `E2E-004`.

- `TH-015` — Demo data is mistaken for customer data by an operator.
  Controls: `CTRL-012`. This specification relies on environment separation
  rather than an in-product indicator, because the dataset never shares a
  database with customer data. Accepted residual: an operator who connects to
  the wrong database sees no in-product warning. Carried to `SPEC-0008`, where
  the environment boundary is built.

## Controls

- `CTRL-001` — Tenant isolation, unchanged: the tenant-guard Prisma extension
  in `apps/web/src/lib/db.ts` refuses an unscoped query, and row-level security
  independently constrains the connected role. This specification adds tests,
  not controls.

- `CTRL-002` — Permission and scope evaluation in
  `apps/web/src/lib/security/rbac.ts`, enforced before a handler body runs,
  using the catalogue grants in `apps/web/prisma/seed/roles.ts`. Unchanged.

- `CTRL-003` — Platform authority lives on the platform identity, not on a
  workspace membership. The Management persona holds a tenant-wide wildcard
  inside one workspace and no platform role. Unchanged.

- `CTRL-004` — The four environment refusals on the demo seed: the build
  declaration, the deployment declaration, the target database's name, and an
  explicit operator opt-in. Preserved unweakened; `SEC-001`.

- `CTRL-005` — A catalogue-driven reset coverage check, comparing tenant-scoped
  models against the set the reset clears plus a reviewed exclusion list. New;
  `AD-007`.

- `CTRL-006` — Environment-level provider selection. In a demo environment the
  mail, messaging and antivirus providers are the mock implementations the
  application already supports, so nothing leaves the host. Configured in
  `SPEC-0008`; this specification verifies the behaviour rather than owning the
  configuration.

- `CTRL-007` — The demo workspace holds no integration connection, so there is
  no outbound vendor credential and no inbound callback key.

- `CTRL-008` — The dataset is generated from an invented corpus and never
  writes a biometric, bank, compensation or payroll record. `DATA-001` to
  `DATA-004`.

- `CTRL-009` — The repository's committed-test-data scan, which fails on
  prohibited fixture classes.

- `CTRL-010` — Existing authentication protections apply to demonstration
  logins exactly as to any account: per-account throttle, per-IP throttle,
  account lockout, password hashing, and a single non-enumerating failure
  message.

- `CTRL-011` — No credential in source. The seed generates a password per run
  and prints it once to the operator; nothing writes it to a file. Deployed
  credential handling is `SPEC-0008`.

- `CTRL-012` — Environment separation: demo data lives in a database that holds
  no customer records, cross-checked at boot against the declared environment
  by `apps/web/src/lib/startup-check.ts`.

## Residual risk

1. `TH-015` — no in-product demo indicator. Accepted at this level; the control
   is environment separation, and an indicator belongs with the environment.
2. `TH-012` — a shared demonstration credential is a standing exposure for as
   long as the accounts are active. Bounded by synthetic data and a disposable
   database.
3. `EVC-004` is an open conflict covering documentation that describes
   row-level security as not yet in force against migrations and gates
   indicating otherwise. This specification cites that entry, changes nothing
   about it, and writes its isolation tests against observed behaviour so that
   the tests stay valid whichever document is correct.
