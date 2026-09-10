# Foundation Closeout

Closes the eight items raised against the Foundation package. Nothing here is
merged or deployed, and P1-1 has not been started — see §11.

|                             |                                                               |
| --------------------------- | ------------------------------------------------------------- |
| Repository                  | `GreenArrow-7/Master-Suit`                                    |
| Baseline                    | `f16ed677516fb07f31832a5d725e13efb477c34d`                    |
| Closeout HEAD               | `701be3e27964b0db159cfad0ba6d205c3e637921`                    |
| Branch                      | `claude/restructure-foundation` (isolated worktree, unpushed) |
| Deployment runtime verified | Linux (`node:24-bookworm`), against the compose stack         |
| Release path verified       | `output: 'standalone'`, `NODE_ENV=production`, behind TLS     |

---

## 1. Commits

Baseline `f16ed67` → closeout `701be3e`. Separately reviewable by category, in
order:

| SHA       | Category           | Subject                                                                       |
| --------- | ------------------ | ----------------------------------------------------------------------------- |
| `ea08902` | docs               | Phase 1 workflow blueprint, code map, backlog and decisions                   |
| `4a189ca` | test               | refuse to run the server suites against an unnamed database                   |
| `aa12237` | **security**       | `fix(hr-reports)`: apply the granted scope instead of discarding it           |
| `f2326c4` | **security**       | `fix(hr-actions)`: stop an unrelated permission blocking the payroll approver |
| `247b231` | **dependencies**   | clear the production audit — next, nodemailer, sharp                          |
| `9c91f4b` | docs               | assess the existing visual system before changing it                          |
| `ab58162` | test               | let the suite run against a TLS-terminated production server                  |
| `7772173` | docs               | foundation package checkpoint                                                 |
| `047f06f` | chore              | ignore the AGENTS.md/CLAUDE.md next 16.3 writes at build time                 |
| `80ce214` | **test isolation** | one gate for every write-producing suite, and real STARTTLS                   |
| `88de81c` | **defect**         | `fix(attendance)`: store a portable capture path, not the host's separator    |
| `6b626d8` | test               | let the prologue check see its own exemptions on Windows                      |
| `5291385` | **visual**         | fix the mobile table overflow, raise the type scale, clear AA                 |
| `0004e71` | style              | apply Prettier to the HR permission-boundary specs                            |
| `74390fa` | chore              | keep Playwright traces out of the evidence directory                          |
| `6394e92` | **docs**           | correct the next-action and reminder contracts                                |
| `701be3e` | docs               | before/after previews for the visual comfort pass                             |

Security repairs, dependency updates, visual changes and test-infrastructure
changes are in separate commits. No commit mixes categories. This document is
committed on top of the table above.

## 2. Item status

| #   | Item                                         | Status                        |
| --- | -------------------------------------------- | ----------------------------- |
| 1   | Staging email without weakening TLS          | **Done** — §3                 |
| 2   | Isolation across every write-producing suite | **Done** — §4                 |
| 3   | Browser test inventory reconciled            | **Done** — §5                 |
| 4   | Linux and production-runtime verification    | **Done** — §6                 |
| 5   | HR permission-boundary evidence              | **Done** — §7                 |
| 6   | Next-action and reminder contracts           | **Done (specification)** — §8 |
| 7   | Visual comfort and previews                  | **Done** — §9                 |
| 8   | This package                                 | **Done**                      |

---

## 3. Item 1 — Staging email, corrected

### 3.1 The earlier diagnosis was wrong

The foundation checkpoint reported _"Mailpit does not implement STARTTLS"_. That
is incorrect and is withdrawn. Mailpit v1.30.7 implements STARTTLS and exposes
`--smtp-tls-cert`, `--smtp-tls-key` and `--smtp-require-starttls`
(`MP_SMTP_TLS_CERT`, `MP_SMTP_TLS_KEY`, `MP_SMTP_REQUIRE_STARTTLS`).

The actual cause: **the repository's compose file configures no certificate.**
With no key pair, Mailpit has nothing to offer on `STARTTLS`, so the server
advertises none — and the application's `SMTP_REQUIRE_TLS` correctly refused to
fall back to plaintext. The refusal was the security control working. The gap
was in the test fixture, not in Mailpit and not in the application.

### 3.2 What was built

`apps/web/scripts/make-local-tls.sh` mints, into a gitignored directory:

- one local CA (`CN=Master Suite Local Test CA`);
- an **SMTP** leaf — `CN=mailpit.test`, SAN `DNS:mailpit.test, DNS:localhost, IP:127.0.0.1`;
- a **browser HTTPS** leaf — `CN=localhost`.

Two separate leaves, deliberately: SMTP certificate trust and browser HTTPS
trust are established independently and both are verified. Neither borrows the
other's chain.

`apps/web/infra/docker-compose.mailpit-tls.yml` supplies the SMTP pair with
`MP_SMTP_REQUIRE_STARTTLS=true` and `MP_SMTP_AUTH_ALLOW_INSECURE=false`.
Forwarding/release to external recipients stays disabled.

### 3.3 What was _not_ done

- The application's TLS requirement is untouched. `SMTP_REQUIRE_TLS` is on.
- No global certificate-verification bypass. `NODE_TLS_REJECT_UNAUTHORIZED` is
  never set. `NODE_EXTRA_CA_CERTS` **adds a trust anchor** — it does not disable
  verification, and a wrong hostname still fails.
- Playwright's `ignoreHTTPSErrors` defaults to **off** in both `use` and
  `webServer`; the CA is trusted through the OS store instead. It is reachable
  only via an explicit `E2E_ALLOW_UNTRUSTED_TLS=yes`.
- Mailpit forwarding remains disabled.
- No private key or certificate is committed. `apps/web/infra/tls-local/` is
  gitignored, with the reason recorded in `.gitignore`.

### 3.4 Verification of the chain, not of a green test

`curl` on Windows reported a failure against the local CA — schannel's
"revocation status is unknown", which is a curl-on-Windows artifact for a CA
with no CRL/OCSP endpoint, not a chain fault. Verified with Node's TLS stack
instead, which is what the application actually uses:

| Condition                                           | Result                            |
| --------------------------------------------------- | --------------------------------- |
| With `NODE_EXTRA_CA_CERTS` pointing at the local CA | `authorized: true`                |
| Without it                                          | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| Correct chain, wrong hostname                       | `ERR_TLS_CERT_ALTNAME_INVALID`    |

The second and third lines are the ones that matter: they show verification is
still being performed and hostname checking is still enforced. A bypass would
have produced `authorized: true` in all three.

`NODE_EXTRA_CA_CERTS` is read by Node from the **real process environment at
startup** and is _not_ honoured when passed via `--env-file`. It is exported
before launch; this cost one misdiagnosed "unable to verify the first
certificate" and is documented so it is not repeated.

### 3.5 Retrieval and the flows exercised

`lastMailTo` (`tests/e2e/helpers.ts`) reads Mailpit's **API v1** when
`E2E_MAILPIT_URL` is set — polling `/api/v1/search?query=to:"<addr>"`, then
`/api/v1/message/<ID>` — and falls back to the development outbox only when it
is not. **The development outbox is never enabled in production mode.**

Against `NODE_ENV=production` on the standalone build, over TLS:

| Flow                                                        | Result |
| ----------------------------------------------------------- | ------ |
| Invitation sent, exactly one email, accepted                | pass   |
| Password reset, a real address receives a link              | pass   |
| Reset link consumed once, second use refused                | pass   |
| Expired / invalid token refused                             | pass   |
| Unknown address produces no email and no account disclosure | pass   |

## 4. Item 2 — Isolation coverage

`apps/web/tests/helpers/isolation.ts` is now the single gate.
`tests/server/environment.ts` is a thin wrapper over it, and the browser suite
runs it from a Playwright `globalSetup` **before any worker starts** — the gap
that mattered most, since the browser suite writes more data than any other.

### 4.1 Checks performed

| Check                  | What is actually verified                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explicit targets       | `E2E_DATABASE_URL` and `E2E_REDIS_URL` required, **no fallback**. A missing variable stops the run rather than silently meaning "default".                                                                                           |
| Disposable name        | Suffix `_test/_val/_ci/_e2e/_scratch/_tmp`. Treated as an **accidental-target safeguard, not proof of safety**.                                                                                                                      |
| Override scope         | `E2E_ALLOW_UNMARKED_DATABASE=yes` waives **only** the name check. Every other check still runs.                                                                                                                                      |
| Same-target comparison | Fixture and **server** destinations compared as resolved `host:port/name`, with real environment beating the env file — the precedence the server itself applies. Two differently-spelled URLs pointing at one database are refused. |
| App env file           | `E2E_APP_ENV_FILE` (absolute paths supported), because a production-mode run uses a different env file from `.env`.                                                                                                                  |
| Role identity          | Fixture and app usernames must differ — **and that is treated as necessary, not sufficient**.                                                                                                                                        |
| Role **properties**    | `pg_roles` queried for `rolsuper` and `rolbypassrls` on the role the app will connect as. A username is a label; `rolbypassrls` is the fact that decides whether RLS is enforced.                                                    |
| Redis                  | Host, port **and logical database** compared; the app's Redis must be loopback.                                                                                                                                                      |
| DB-backed integrations | Any `IntegrationConnection` with `status='CONNECTED'` refuses the run outright.                                                                                                                                                      |
| Providers              | Email, WhatsApp, telephony, push (FCM/APNs), Meta, AI (Gemini), storage (S3/MinIO), antivirus, face service — see §4.2.                                                                                                              |
| Secrets                | Targets rendered as `host:port/name`. **No credential is ever printed**, in a pass or a failure.                                                                                                                                     |

### 4.2 Two explicit profiles

A production-mode run cannot use `mock`, and weakening the mock rule to permit
it would have removed the guard's entire purpose. So there are two profiles, and
the second permits a provider only where it is **provably inert**:

- **`mock`** — every provider mocked. The default; the strict rule is unchanged.
- **`local-capture`** — production mode against verified local capture only:
  - `EMAIL_PROVIDER=smtp` permitted **solely** with a loopback `SMTP_HOST`;
  - `WHATSAPP_PROVIDER=meta` permitted **solely** while `META_APP_ID`/`META_APP_SECRET`
    are empty **and** no `IntegrationConnection` is CONNECTED;
  - `ANTIVIRUS_PROVIDER=clamav` permitted **solely** with a loopback `CLAMAV_HOST`;
  - storage must be a loopback `S3_ENDPOINT`;
  - any external credential present (FCM, APNs, Gemini, Meta, a non-loopback
    SMTP host) refuses the run.

A local SMTP capture service is not treated as equivalent to an external
delivery provider; it is permitted at a named loopback address, and nowhere
else.

### 4.3 Tests

`tests/unit/test-isolation-guard.spec.ts` — **28 tests, all passing**. Both
profiles, behavioural refusals _and_ positive cases: each check is shown to
refuse the unsafe configuration and to accept the safe one, so a guard that
refused everything would fail the suite just as loudly as one that refused
nothing.

## 5. Item 3 — Browser inventory reconciled

Three runs, reconciled by exact test identity. **No test was removed, skipped or
weakened at any point.**

| Run                      | Reported | Passed | Failed | Never ran |
| ------------------------ | -------- | ------ | ------ | --------- |
| Baseline (`f16ed67`)     | 43       | 42     | 1      | 0         |
| Foundation checkpoint    | 35       | 30     | 5      | 8         |
| **Closeout (`701be3e`)** | **43**   | **43** | **0**  | **0**     |

### 5.1 Why the checkpoint said 35

Playwright does not run the remaining tests in a `describe` configured
`mode: 'serial'` once one of them fails, and does not count them in the total.
The checkpoint's 5 failures sat inside serial describes; the 8 tests that
followed them never ran and were therefore never reported.

The 8, by exact identity:

- `invitation.spec.ts:74`, `invitation.spec.ts:89`
- `password-reset.spec.ts:73`, `password-reset.spec.ts:97`
- `ui-states.spec.ts:109`, `:126`, `:135`, `:149`

35 reported + 8 never run = 43. The inventory never changed.

The 5 checkpoint failures were all environment, and all diagnosed:

| Failure                     | Cause                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `acceptance.spec.ts:69`     | `.env` `APP_URL` was `:3000` while the server ran on `:3210` — my configuration error, not a product defect |
| `hr-modules.spec.ts:127`    | same                                                                                                        |
| `invitation.spec.ts:50`     | Mailpit had no certificate (§3.1)                                                                           |
| `password-reset.spec.ts:59` | same                                                                                                        |
| `ui-states.spec.ts:92`      | session cookie is `secure` under `NODE_ENV=production`, served over plain HTTP                              |

### 5.2 The baseline's one failure: the team-feed reaction

Baseline failure: `modules.spec.ts:55` — _"a fresh workspace can reach and use
every sales module"_, at the team-feed reaction step.

**Current status: passing.** Stable across repeated runs, in dev-mode runtime
and on the production standalone build, including the closeout run in §6.3.

Cause, stated with the uncertainty it deserves: `git diff f16ed67..701be3e`
shows `modules.spec.ts` and the feed/posts/engagement source **byte-identical**.
Only two application source files changed in that range (`services/hr/reports.ts`
and the HR actions route), neither related to the team feed. The only changed
variable that plausibly explains it is the **Next 16.2.12 → 16.3.4 upgrade**
carried in the dependency commit. **This was not bisected**, so it is a
plausible explanation, not a demonstrated one. It is recorded as a residual risk
in §10 rather than claimed as fixed.

## 6. Item 4 — Linux and production-runtime verification

The seven Windows failures are **no longer reported as "expected to pass on
Linux"**. They were investigated, and that framing turned out to be wrong for
six of them.

### 6.1 Linux — the intended deployment runtime

`node:24-bookworm`, on the compose network, repository mounted read-only and
copied inside so the Windows `node_modules` is never touched.

| Gate                | Exit | Gate                                     | Exit |
| ------------------- | ---- | ---------------------------------------- | ---- |
| typecheck           | 0    | observability                            | 0    |
| lint                | 0    | redis auth                               | 0    |
| format              | 0    | face tokens                              | 0    |
| schema drift        | 0    | backup round-trip                        | 0    |
| RLS check           | 0    | **unit — 2002/2002 pass, 155/155 files** | 0    |
| raw-SQL scope       | 0    | production audit (high)                  | 0    |
| README schema stats | 0    | production build                         | 0    |

**14 of 14 gates pass. 2002 of 2002 unit tests pass. Zero failures.**

Two earlier Linux runs are discarded and the reasons recorded, because both were
harness faults that would otherwise have been reported as product results:

1. Nested shell quoting expanded in the outer shell (`DB_APP: unbound variable`).
   Fixed by mounting the inner script rather than nesting it.
2. The container snapshotted the tree mid-edit, producing TS2559 typecheck
   errors that did not exist in the settled tree.
3. A third run showed 6 unit failures, all harness: `cp .env .env.test` clobbered
   the suite's own `APP_URL` (5 origin-check failures), and excluding `.git` from
   the copy made `buildId()` fall back to `'unknown'` (1 failure). Fixed by
   preserving `APP_URL` and passing `BUILD_COMMIT`, as a deployment does.

### 6.2 The Windows failures, resolved

7 → **2**, and the six that closed were not noise.

**Six of the seven were one genuine cross-platform data-format defect.**
`captureVault.pathFor` built `HrAttendancePunch.capturePath` with `path.join`,
which emits the _host's_ separator. That value is not a path on the machine that
wrote it — it is an identifier written to a database column and later split on
`path.sep` to build an object key. A capture stored on a Windows host held
`t-x\emp-y\2026-08\punch-z.jpg.enc`; a Linux reader split it on `/`, found
nothing to split, and asked the bucket for a key that does not exist. **The
biometric frame that is the evidence for a disputed attendance punch became
unreadable.**

It passes on Linux only because Linux's separator happens to be the correct one.
The code is wrong on any host whose separator is not `/`, and the function's own
docblock already promised `/`. This is exactly the class of problem the item
asked to be checked for, and it would not have been found by treating the
Windows failures as harmless.

Fixed in `88de81c`, with two behavioural tests — the column never carries a host
separator, and a stored capture round-trips through the object key. Both were
run against the **unfixed** implementation and fail; six capture-vault tests
fail without the fix and fourteen pass with it.

A seventh, adjacent finding: `guarded-prologue.spec.ts` compared `globSync`
output against a `/`-separated exemption list, so on Windows it reported both
legitimate pre-authorisation routes as hand-rolled security prologues on every
run. A permanently-red invariant test is one people learn to scroll past. Fixed
in `6b626d8`; the assertion is unchanged.

**The 2 that remain, and why they are not closed:**

`observability.spec.ts` asserts `statSync(file).mode & 0o777 === 0o600` on files
written by the Prometheus and Alertmanager entrypoints. Windows reports `0o666`
because **NTFS does not implement POSIX permission bits** — `chmod 600` in the
shell script has no effect there. The property being asserted cannot exist on
that filesystem.

These are **verified passing on Linux**, the deployment OS (§6.1, `17-observability`
exit 0). They are reported as an unfixable-on-Windows platform limitation with
Linux evidence, not as closed. The assertions were left intact rather than made
to skip on `win32`: skipping is defensible, but it reduces what a Windows
developer sees run, and that is the reviewer's call rather than mine.

### 6.3 Production runtime

Not a production build served with `NODE_ENV=development`. The actual release
path: `next build` with `output: 'standalone'`, served by
`.next/standalone/server.js` under `NODE_ENV=production`, behind a TLS
terminator (the session cookie is `secure` in production, so plain HTTP cannot
authenticate).

**Browser suite against that stack: 43 of 43 pass.** Isolation gate reported
`profile=local-capture` before the first worker started. Teardown removed 15
workspaces and 20 accounts tagged with the run's own tag.

## 7. Item 5 — HR permission-boundary evidence

### 7.1 Finding D, and what it actually leaked

`services/hr/reports.ts` `resolve()` used `can()`, which collapses a scope to a
boolean. Every one of the 17 reports then queried `where: { tenantId }` — the
whole workspace, for anyone with the permission at any scope.

Measured on the production build, `master_suite_val`:

| Actor             | Granted scope | Payslips before              | after         |
| ----------------- | ------------- | ---------------------------- | ------------- |
| `employee`        | OWN           | **9** (9 distinct employees) | **1**         |
| `payroll_officer` | ORGANIZATION  | 9                            | 9 (unchanged) |

Headcount for `employee`: **49 → 1**.

The fix introduces `ReportSubject`/`ReportAudience` and annotates each of the 17
reports with its subject and its subject field. `within()` composes as
`AND: [{ field: { in: audience.employeeIds } }]` rather than as a bare key, so a
caller-supplied filter cannot displace it.

### 7.2 Coverage — `tests/security/hr-report-scope.spec.ts`, 22 tests

| Dimension              | Covered                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| Every scope            | NONE, OWN, TEAM, BRANCH, REGION, ORGANIZATION                                    |
| Cross-workspace        | a second tenant's employees never appear at any scope                            |
| Filters cannot widen   | an explicit `employeeId` outside the audience returns nothing, not that employee |
| Missing linkage        | a user with no employee record gets an empty result, never all                   |
| Empty team             | a manager of an empty team gets nothing, never all                               |
| Removed membership     | an employee moved out of a team leaves the audience immediately                  |
| List / results / CSV   | the same audience applies to `availableReports()`, `run()` and the export path   |
| Workspace-wide reports | refused below ORGANIZATION in both `resolve()` and `availableReports()`          |
| Audit                  | the export audit record carries `scope: audience.scope`                          |

> **An empty permitted audience never means "all employees."** `employeeIds: []`
> produces `{ in: [] }` — zero rows. Only `employeeIds === null`, reachable only
> at ORGANIZATION, means unrestricted. There are explicit tests for the empty
> case at every scope, because "empty means everything" is the specific way this
> class of bug is usually reintroduced.

**6 of 8 core tests fail against the unfixed code.**

### 7.3 Payroll approver — every permission category inspected

The kernel asserted `employee:VIEW` _before_ the per-action permission, so
`finance_admin` — who holds `payroll:APPROVE` and not `employee:VIEW` — was
refused at a gate that had nothing to do with the action.

Fixed by declaring the route `selfService: true` (so the kernel does not assert
`employee:VIEW`) and then asserting the action's own permission, with
self-service actions asserting **exactly the previous floor** — not a lower one.

| Actor                              | Action                  | Before  | After                                    |
| ---------------------------------- | ----------------------- | ------- | ---------------------------------------- |
| `finance_admin`                    | payroll approve         | **403** | **200**                                  |
| `payroll_officer` (own submission) | payroll approve         | 403     | **403** — separation of duties preserved |
| `sales_rep`                        | payroll approve         | 403     | **403**                                  |
| any employee                       | own self-service action | 200     | 200                                      |

`tests/security/hr-action-authority.spec.ts` — **35 tests**. Every one of the
**seven** permission categories the route maps is asserted in **both**
directions (granted → allowed, not granted → refused), plus self-service
scoping, unmapped actions, unauthenticated requests, cross-workspace requests,
entitlement, and the audit record. **2 of 8 core tests fail against the unfixed
code.**

Separation of duties was not relaxed to unblock the approver, and no broad
administrator grant was used.

All three security specs run green: **85 tests** (22 + 35 + 28).

## 8. Item 6 — Corrected contracts

Specified in **[`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)**.
Specification only: **no schema migration, no `FollowUpTask` consolidation, and
P1-3 is not implemented.** `Activity` is retained as history and is explicitly
not the obligation store.

### 8.1 The rule that was withdrawn

The earlier draft's _"at most one open obligation per lead per kind"_ is
withdrawn. It is not a contract; it is a data-loss policy. A buyer can owe a
callback _and_ a site visit _and_ a document chase on one day.

> **An obligation is unique by its own identity. Nothing about a lead or a kind
> constrains how many may be open.**

### 8.2 What the corrected contract specifies

- **Obligation identity** — the primary key, and nothing else. No natural key.
- **Idempotency identity** — a _separate_, nullable `sourceKey`, unique per
  tenant. Machine-originated causes mint one derived from the cause
  (`rule:<ruleId>:<eventId>`, `intake:<provider>:<messageId>`,
  `recur:<parentId>:<occurrenceISO>`, `sla:<leadId>:<breachAtISO>`). **A human
  action never carries one** — silently collapsing a person's second click into
  their first is how somebody comes to believe they scheduled something they did
  not.
- **Retry vs deliberate-new** — carried entirely by whether the caller supplies
  the _same_ `sourceKey`. An endpoint must never infer "this looks like a retry"
  from field similarity.
- **Rescheduling vs replacement** — two distinct operations. Reschedule moves
  `dueAt` in place, keeping `id` and history. Replace closes the old obligation
  as `CANCELLED` with `replacedById`, never as `COMPLETED`, and links the new one
  by `replacesId`. Neither row is deleted.
- **History preserved** — every transition appends an `Activity` row carrying
  the lead, the actor, the transition and the delta (a reschedule records both
  the old and the new time). Terminal states are terminal; reopening is a new
  obligation, not a state flip.
- **Derived `Lead.nextFollowUpAt` with multiple open tasks** — the **earliest
  `dueAt` among all open obligations on that lead, across every owner and every
  kind**. The minimum of a set of any size is one value, so no one-per-lead rule
  is needed or wanted. Recomputed by a single SQL statement inside the same
  transaction as the obligation write, so there is no read-modify-write window;
  and treated explicitly as a cache with a drift-detecting reconciliation sweep.

**A grounded finding while specifying this:** `Lead.nextFollowUpAt` currently
has **no writer anywhere in application code**. It is read by six surfaces — the
Overdue filter, the sortable grid column, the lead-detail flag, the sales
overdue count, the built-in Overdue smart view, and the leadership exception
queue — and written only by seed and by tests. Every "overdue" surface in Sales
is driven by a column the product never updates. Deriving it is small, needs no
new UI, and unblocks all six.

### 8.3 The reminder contract

- **One logical notification, many delivery attempts.** `Notification` carries
  `emailedAt`/`emailError` — a single outcome — so "email landed but push
  failed" is currently unrepresentable and one channel cannot be retried without
  re-notifying.
- **Existence-check-then-insert is insufficient, for three independent reasons.**
  `services/crm/reminders.ts` embeds `NOT EXISTS` in its `SELECT` and inserts in
  a **separate transaction**. (1) The check and the insert are not atomic — two
  sweeps both see nothing and both write. (2) Even in one transaction it would
  not hold: under `READ COMMITTED`, `NOT EXISTS` takes no lock and cannot see an
  uncommitted concurrent insert. (3) `Notification` has **no unique constraint
  at all**, so nothing would refuse the duplicate.
- **A fourth defect, already shipped.** The dedupe key uses
  `recordId = COALESCE(t."leadId", t.id)`, so **two open tasks on one lead
  collapse to one reminder** — the rep is told about one and never about the
  other. That is the withdrawn one-per-lead assumption, in running code, losing
  reminders today.
- **Atomic claiming** — `@@unique([tenantId, obligationId, kind, dueAtRaised])`
  with `INSERT … ON CONFLICT DO NOTHING … RETURNING`. `obligationId` (not the
  lead) fixes the collapse; `dueAtRaised` makes a re-run the same reminder and a
  rescheduled obligation a different one. The claim _is_ the write. This
  **replaces** the existence check rather than backing it up.
- **Rescheduling invalidates** — undelivered reminders for the old time are
  cancelled; **delivered ones are kept**, because deleting them makes the audit
  lie. The new time is reminded on the next sweep, which is correct behaviour
  and not a duplicate.
- **Retry belongs to delivery** — bounded backoff per attempt, the reminder row
  untouched and never re-created. Exhausted retries leave the reminder visible
  in-app, the one channel with no provider in between.
- **Forbidden**: a `remindedAt` column on the obligation, dedupe on notification
  text, or a suppression window used as the correctness mechanism.

## 9. Item 7 — Visual comfort

Every number below is **measured on the production standalone build through the
running application**, in **all three themes** (light, dark, glass) — not read
off the token file.

### 9.1 The layout defect

People → Leave scrolled **274px** sideways on a 390px screen, and the
stacked-card mobile table layout the stylesheet already contained was
unreachable. Two cascade causes, both fixed:

- `.lf-table-wrap` is a flex/grid item in most of its parents, and such an item
  defaults to `min-width: auto` — "at least as wide as my content". The wrapper
  grew to the table's minimum, `overflow: auto` never engaged, and the _page_
  scrolled instead of the table.
- `.lf-table { min-width: 640px }` sits ~3600 lines below two
  `@media (max-width: 760px)` blocks that reset it to `0` for the card layout. A
  media query adds no specificity, so the later flat rule won the cascade and
  put the floor back on every phone.

**274px → 0px.** All 14 preview captures now report 0px horizontal overflow.

### 9.2 Type

|                                        | Before     | After             |
| -------------------------------------- | ---------- | ----------------- |
| Body                                   | 15px       | **16px**          |
| Grid body (table cells)                | 13px       | **14px**          |
| Form inputs                            | 14px       | 14px              |
| Column headers                         | 11px       | **12px**          |
| Badges, small buttons (`--lf-text-xs`) | 11px       | **12px**          |
| Eyebrow labels (`--lf-text-2xs`)       | 10px       | **11px**          |
| Sidebar navigation links               | 12.5px     | **13.5px**        |
| Sidebar section labels                 | 10px       | **11px**          |
| Signed-in identity line                | 11px / 9px | **12.5px / 11px** |

Column headers were taken to 12px and left uppercase rather than to 14px: 14px
uppercase would widen every column on a table with a 640px floor, trading one
comfort problem for another. **This is a deliberate shortfall against a ≥14px
reading of "table text" and is stated rather than glossed** — the data cells,
which are what people actually read, are 14px.

### 9.3 Compact density was broken

`--lf-row` existed (44px comfortable / 32px compact) and the toggle flipped it,
but every table hardcoded `height: 44px` and never read the token. **Compact
only shrank the text and fitted no extra rows** — the one setting for "fit more
on screen" was in practice the setting for "and squint at it".

Tables now read `var(--lf-row)`, and the compact block no longer overrides
`--lf-text-sm`: density is row height, not type size.

|                     | Row height | Cell text |
| ------------------- | ---------- | --------- |
| Comfortable         | 44px       | 14px      |
| Compact — before    | 44px       | 13px      |
| **Compact — after** | **39px**   | **14px**  |

### 9.4 Contrast, measured in every theme

**161 distinct rendered `(colour, background, size, weight)` pairs** across
light, dark and glass on two screens. Foreground alpha is composited over the
resolved background before the ratio is computed — reading only the RGB out of
an `rgba()` had overstated every sidebar measurement.

**Result: 0 pairs below WCAG AA, in all three themes.**

Four failures were found and fixed:

| Element                                                                                       | Before                                     | After                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------- |
| Unread-count badge (dark/glass) — `#fff` hardcoded over `--lf-vermillion`                     | **2.79:1**                                 | 5.42:1 light, **6.82:1** dark   |
| `::selection` (dark/glass) — `--lf-wine-900` is a panel background, near-black in every theme | **1.53:1** — selecting text made it vanish | 14.63:1 light, **11.25:1** dark |
| Sidebar section labels                                                                        | **3.48:1**                                 | **5.34:1**                      |
| "by YOUHAN" footer label                                                                      | **2.56:1**                                 | **5.34:1**                      |

The badge now uses `--yh-on-primary`, the token that already flips with
`--lf-vermillion` (the pairing `.lf-btn--danger` uses). `::selection` was given
its own token pair, so a change to either theme's panel colours cannot silently
break it again.

The earlier token ramp is confirmed in place: light secondary `#4d5766`
(6.7–7.3:1), muted `#667085` (4.6–5.0:1 AA), faint `#858e9c` (3.0–3.3:1,
AA-large, documented as non-informational only); dark muted `#768498`
(4.5–5.3:1), faint `#5a687c` (3.0–3.5:1).

### 9.5 States

| State              | Evidence                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Focus**          | 12 consecutive real `Tab` stops: all 12 match `:focus-visible`, all 12 carry a visible ring, all 12 on screen. Two-ring indicator (`0 0 0 2px <surface>, 0 0 0 4px #087bf5`) — the separator ring adapts per theme.                 |
| **Selection**      | Own token pair; 14.63:1 light, 11.25:1 dark (§9.4).                                                                                                                                                                                 |
| **Hover**          | Row-hover rules confirmed present and resolving in all three themes.                                                                                                                                                                |
| **Error**          | Sign-in validation error: `role="alert"`, 13px, **15.23:1**.                                                                                                                                                                        |
| **Disabled**       | `opacity: 0.5` + `cursor: not-allowed`; effective label 3.38:1 light / 5.03:1 dark. WCAG 1.4.3 exempts disabled controls; the light figure is noted in §10 as mushy rather than as a failure.                                       |
| **Reduced motion** | **Correction to the earlier assessment, which wrongly reported this absent.** `@media (prefers-reduced-motion: reduce)` is present at `globals.css:2080`, `globals.css:3744` (a deliberate spinner exception) and `tokens.css:407`. |
| **Zoom 200%**      | 0px horizontal overflow, content rendered.                                                                                                                                                                                          |
| **Loading**        | Skeletons already read `var(--lf-row)`, so they now match the density they load into.                                                                                                                                               |

### 9.6 Previews

Desktop (1440×960) and mobile (390×844), before and after, of the five screens
asked for plus two more, from realistic synthetic records on the production
build:

| #   | Screen                                | Route                                 |
| --- | ------------------------------------- | ------------------------------------- |
| 1   | Agent work screen                     | `/sales` as an agent                  |
| 2   | Agent lead list                       | `/sales/leads`                        |
| 3   | Customer detail / timeline            | `/sales/leads/<id>`                   |
| 4   | Manager dashboard / exception surface | `/sales` as a workspace administrator |
| 5   | Employee self-service                 | `/people` as an employee              |
| 6   | HR leave administration               | `/people/leave` as HR                 |
| 7   | HR attendance                         | `/people/attendance` as HR            |

`validation-evidence/previews/{before,after}/` — 14 images each.
`validation-evidence/previews/states/` — 6 further captures: comfortable and
compact density, keyboard focus, disabled controls, a validation error, and 200%
zoom.

Two harness faults were fixed during capture and are recorded so the images are
not over-read: the login rate limit (10 per 5 minutes per IP, and every capture
arrives from loopback) put later screens on `/login`, fixed by clearing the
limiter between screens plus a two-attempt retry; and the capture script now
throws rather than silently screenshotting the login page.

## 10. Residual risks

1. **The team-feed reaction test's recovery is not demonstrated.** It fails at
   baseline and passes now, stably; the only plausible cause is the Next
   16.2.12 → 16.3.4 upgrade, and **it was not bisected**. If it regresses, start
   there.
2. **Two Windows unit tests remain red** (§6.2) — POSIX file modes on NTFS.
   Verified passing on Linux. The choice not to skip them on `win32` is left
   open for review.
3. **Compact density is not persisted.** It is `useState` in `TopBar`, so it
   resets on every reload, unlike the theme. Out of scope for a comfort pass and
   noted rather than changed.
4. **Disabled controls measure 3.38:1 in light.** WCAG exempts them, and lower
   contrast is the intended signal; it is at the mushy end and is a design call.
5. **Column headers are 12px, not 14px** (§9.2) — a stated, deliberate shortfall.
6. **`Lead.nextFollowUpAt` still has no writer** (§8.2). Six Sales surfaces
   currently read a column nothing updates. Specified, not implemented.
7. **The reminder sweep can still double-send and still collapses two tasks on
   one lead into one reminder** (§8.3). Specified, not implemented.
8. **`Task` and `FollowUpTask` remain two live obligation tables.** Unchanged by
   design; P1-3.
9. **Faint text is AA-large only** (3.0–3.3:1) and is documented as valid for
   non-informational text only. Any informational use of `--yh-text-faint` is a
   defect.

## 11. What was not done

- **P1-1 was not started.** The instruction body said twice not to begin it
  during this package; the message's final line said to start it. The body was
  treated as authoritative, and this is flagged for an explicit decision.
- Nothing was merged, pushed or deployed. The branch is local to an isolated
  worktree.
- No task-data migration was performed. `FollowUpTask` is untouched.
- No production configuration was changed.
- No test was removed, skipped or weakened; no assertion was relaxed. Every
  rerun in this package has a named cause.

## 12. Test services left running, and how to remove them

Ownership established before listing; **nothing was deleted whose ownership and
scope were not established.**

### 12.1 Started by this work

| Service                                 | Identity                                                                                                   | Removal                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ClamAV container                        | `master-saas-clamav-1` (`clamav/clamav:stable`, `127.0.0.1:3310`)                                          | `docker rm -f master-saas-clamav-1`                                      |
| Local test CA in the Windows user store | `CN=Master Suite Local Test CA`, thumbprint `CBD8432DB961D5BFF5F9429F7214D4FD4F7FA08E`, expires 2026-10-10 | `certutil -delstore -user Root CBD8432DB961D5BFF5F9429F7214D4FD4F7FA08E` |
| Standalone production server            | `node server.js` on `:3320`                                                                                | stop the process                                                         |
| TLS terminator                          | `:3443`                                                                                                    | stop the process                                                         |
| Validation databases                    | `master_suite_val`, `master_suite_val_shadow`, `master_suite_val_unit`, `master_suite_val_unit_shadow`     | `dropdb` as the owning role, when the evidence is no longer needed       |

The CA is in `CurrentUser\Root`, not the machine store: it is trusted for this
user only, and removal needs no elevation.

### 12.2 Pre-existing — left alone

`master-saas-postgres-1`, `master-saas-redis-1`, `master-saas-minio-1`,
`master-saas-mailpit-1` are the repository's own development stack. Mailpit's
STARTTLS configuration is an **additive overlay file**; the base compose file is
unchanged, so omitting the overlay restores the previous behaviour exactly.

The `leadflow` database is the ordinary development database and was not touched
by any suite in this package.

### 12.3 Not committed

`apps/web/infra/tls-local/` (the CA and both key pairs) is gitignored. The
scratchpad artefacts — the staging env file, the TLS terminator, the preview and
measurement scripts, the Linux runner — are outside the repository and carry
credentials; none is committed or included in the evidence directory. A
Playwright trace found in `validation-evidence/` was removed and the directory
gitignored (`74390fa`): a trace records every request header of a real signed-in
session, including the session cookie and any reset or invitation token in
flight.

## 13. Evidence index

All paths relative to the repository root.

| Evidence                                                         | Location                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Baseline validation report                                       | `validation-evidence/BASELINE-VALIDATION-REPORT.md`                                                   |
| Baseline run logs and screenshots                                | `validation-evidence/baseline-run1/`, `validation-evidence/logs/`, `validation-evidence/screenshots/` |
| Baseline reaction-test failure evidence                          | `validation-evidence/e2e-artifacts/modules-*/`                                                        |
| Previews — before                                                | `validation-evidence/previews/before/` (14)                                                           |
| Previews — after                                                 | `validation-evidence/previews/after/` (14)                                                            |
| Previews — states                                                | `validation-evidence/previews/states/` (6)                                                            |
| Workflow blueprint, code map, backlog, decisions                 | `docs/product/{WORKFLOW-BLUEPRINT,CURRENT-CODE-MAP,IMPLEMENTATION-BACKLOG,DECISIONS-REQUIRED}.md`     |
| Design-system assessment                                         | `docs/product/DESIGN-SYSTEM-ASSESSMENT.md`                                                            |
| Foundation checkpoint (superseded on Mailpit and reduced motion) | `docs/product/FOUNDATION-CHECKPOINT.md`                                                               |
| **Corrected contracts**                                          | `docs/product/NEXT-ACTION-AND-REMINDER-CONTRACTS.md`                                                  |
| Isolation setup and reproduction                                 | `docs/TEST-ISOLATION.md`                                                                              |
| Isolation gate                                                   | `apps/web/tests/helpers/isolation.ts`                                                                 |
| Isolation tests (28)                                             | `apps/web/tests/unit/test-isolation-guard.spec.ts`                                                    |
| HR report scope tests (22)                                       | `apps/web/tests/security/hr-report-scope.spec.ts`                                                     |
| HR action authority tests (35)                                   | `apps/web/tests/security/hr-action-authority.spec.ts`                                                 |
| Capture-path tests                                               | `apps/web/tests/unit/capture-vault.spec.ts`                                                           |
| Mailpit STARTTLS overlay                                         | `apps/web/infra/docker-compose.mailpit-tls.yml`                                                       |
| Local certificate generator                                      | `apps/web/scripts/make-local-tls.sh`                                                                  |
| Diagnostic specs for findings A/B/C/E                            | `apps/web/tests/diagnostic/*.diag.ts`                                                                 |

Run logs for the Linux verification, the browser suite, the unit suites and the
contrast measurements are in the session scratchpad rather than the repository:
they carry connection strings and environment values, and the summaries above
are the sanitised form of them.
