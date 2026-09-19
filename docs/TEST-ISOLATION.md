# Test isolation

What a suite is allowed to touch, and what stops it touching anything else.

## The three suites and what each needs

| Suite                | Command               | Server                       | Database it writes                                            |
| -------------------- | --------------------- | ---------------------------- | ------------------------------------------------------------- |
| Unit                 | `npm test`            | none                         | `.env.test` `DATABASE_URL`, through the tenant-guarded client |
| Integration (server) | `npm run test:server` | starts its own               | `E2E_DATABASE_URL`, **explicitly named**                      |
| Browser (E2E)        | `npm run test:e2e`    | starts its own, or `APP_URL` | `.env` `DATABASE_URL`                                         |

## The server suites refuse to guess

`tests/server/*.spec.ts` drive a running application and write real rows. They
used to fall back to a hardcoded connection string when `E2E_DATABASE_URL` was
unset:

```
process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:…@localhost:5432/leadflow'
```

That is the database a developer runs the product against. During the 2026-09-10
baseline validation the suites did write to it. Their own `afterAll` cleaned up
and no residue was left — but "the cleanup happened to work" is not a control.

There is no fallback now. `tests/server/environment.ts` refuses to run unless all
of the following hold, and it is called from `globalSetup` before the server is
started as well as from each spec.

### 1. Both targets are named explicitly

```bash
E2E_DATABASE_URL=...   # a disposable database, as the migration/owner role
E2E_REDIS_URL=...      # a Redis database reserved for tests
```

Unset means refused, not defaulted.

### 2. The database name is marked disposable

The name must end in `_test`, `_val`, `_ci`, `_e2e`, `_scratch` or `_tmp`.

A suffix, not a substring: `leadflow_test` is disposable and
`test_leadflow_production_mirror` is not, and a substring match cannot tell them
apart. If a genuinely disposable database has a name the rule dislikes, say so in
the command that runs the suite:

```bash
E2E_ALLOW_UNMARKED_DATABASE=yes
```

That is deliberately awkward, and deliberately visible to a reviewer, rather than
loosening the rule for everyone.

### 3. Fixtures and the server share one database

The guard compares `host:port/database` for `E2E_DATABASE_URL` and the `.env`
`DATABASE_URL` the server will read, and refuses if they differ.

They must match, or fixtures land in one database while the server reads another.
That surfaces as `401 That email and password combination did not work` on an
account created milliseconds earlier — a failure that looks like broken
authentication and is not.

### 4. Fixtures use the privileged role; the application does not

The two connections share a database and must **not** share a role.

Fixtures create rows across tenants before any tenant context exists, so they need
the BYPASSRLS migration/owner role. The application role is `NOBYPASSRLS` by
design. Running fixtures as the application role does not error: row-level
security matches nothing and reports success, so the rows appear written and are
not, and the suite fails somewhere unrelated.

```bash
E2E_DATABASE_URL=postgresql://<owner>:…@127.0.0.1:5432/<db>_test?schema=public
# .env DATABASE_URL uses master_saas_app — the restricted role
```

### 5. No provider can reach a real recipient

`EMAIL_PROVIDER`, `WHATSAPP_PROVIDER` and `ANTIVIRUS_PROVIDER` must all be `mock`.
These suites send invitations and password resets; with a real provider those
reach real inboxes and real phones.

Telephony, push (FCM/APNs), Meta and AI need no separate check: each requires
credentials that a test environment does not hold, and each returns without
calling out when they are absent.

Credentials held as rows are checked too: `assertRuntimeIsolation` refuses any
`IntegrationConnection` in status `CONNECTED`, with one named exception — the
development `mock` telephony vendor, which dials nothing and posts nowhere. The
demo seed connects it under `NODE_ENV=development` so the business-journey and
assisted-call specs can exercise the calling path, and the provider factory
refuses it in production regardless of what the row says.

## Credentials never appear in output

Every message from the guard reduces a connection string to `host:port/database`
via `describeTarget()`. Test output is pasted into issues and chat windows.

## Running the server suites

```bash
E2E_DATABASE_URL="postgresql://<owner>:<pw>@127.0.0.1:5432/<db>_test?schema=public" \
E2E_REDIS_URL="redis://:<pw>@127.0.0.1:6379/14" \
npm run test:server
```

`scripts/verify.mjs` states the same requirement, because `npm run verify` runs
this gate and used to fail it for environmental reasons with no explanation.

## What this does not cover

- The **unit** suite is guarded by the tenant client and `.env.test`, not by this
  module. It creates its own tenants and deletes them.
- The **browser** suite writes to the `.env` database and cleans up by
  `RUN_TAG` (`tests/e2e/globalTeardown.ts`). Point `.env` at a disposable database
  before running it; there is no equivalent guard yet, and that gap is tracked.
- Nothing here prevents a _deployed_ environment being used as a target. The name
  rule and the provider rule make it awkward; they are not an authorisation
  control.
