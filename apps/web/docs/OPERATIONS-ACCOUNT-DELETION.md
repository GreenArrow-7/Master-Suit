# Operating account deletion

What the executor does is in `src/services/identity/accountDeletion.ts`. This is what a person
does when it stops.

## The switch

`ACCOUNT_DELETION_EXECUTION_ENABLED=true` on the **worker** turns erasure on. Off (the
default, and the state until the retention decisions are recorded): requests are recorded,
shown to the person as "not yet switched on", withdrawable, and nothing is erased. The
`maintenance` queue's `account-deletions` job runs every fifteen minutes either way and reports
`disabled: true` while off.

## Signals

| Metric (`/api/metrics`)             | Meaning                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `masterapp_account_deletions_open`  | Requests REQUESTED, BLOCKED or IN_PROGRESS                                      |
| `masterapp_account_deletions_stuck` | IN_PROGRESS with `attempts >= MAX_ATTEMPTS` (5): the sweep has stopped retrying |

Alert `AccountDeletionStuck` (page) fires when `stuck > 0` for 15 minutes. Worker log line:
`account deletion sweep: requests past the retry cap need an operator`.

## What "stuck" means for the person

Their identity is already **deactivated** and partly erased (step 1 runs first). They cannot
sign in, cannot withdraw the request (it has started), and cannot ask again (one open request
per person). Nobody else can see this from the product. It is an obligation to a named
individual and it does not resolve itself.

## Recovery

1. **Find it.** As the operator on the database (root procedure, read-only):
   ```sql
   select id, "platformUserId", attempts, "startedAt", outcome->>'error' as error
   from "AccountDeletionRequest" where status = 'IN_PROGRESS' and attempts >= 5;
   ```
   `outcome.error` is a code (`step failed: <PrismaCode>` or `verification failed: <fields>`),
   never the payload; the detail is in the worker log at `error` level with the `requestId`.
2. **Fix the cause.** Typical: a verification field still present because a new table
   references the account (add it to the executor), a tenant-guard or RLS refusal (scope the
   query), a foreign key that blocks a delete (decide retain-vs-erase for that table). Deploy
   the fix; do not edit data by hand to make verification pass.
3. **Let the sweep resume it.** Resetting the counter is the only manual write:
   ```sql
   update "AccountDeletionRequest" set attempts = 0 where id = '<id>';
   ```
   The next sweep (≤ 15 min) claims it again; every step is idempotent, so the half done is
   skipped and the rest completes. Confirm `status = 'COMPLETED'` and read `outcome.retained`.
4. **Never** set `status` to COMPLETED or CANCELLED by hand. COMPLETED is written only after
   step 5 re-reads the account; CANCELLED on a started request leaves a deactivated identity
   with no record of why.

## Blocked requests

BLOCKED (primary administrator or last administrator) is not stuck: it is re-checked every six
hours and completes once ownership is transferred; the person can also withdraw and re-ask to
skip the wait. If a workspace's only administrator wants to leave, an administrator must be
appointed first — the executor will not orphan a workspace.
