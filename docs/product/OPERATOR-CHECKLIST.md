# Operator checklist: production evidence

For the authorized production operator. **Nothing here changes production data or configuration. Production remains NOT APPROVED.**

Rules:

- Run on the production host from the deployed checkout. Mark root steps as root.
- Secrets stay where the host keeps them: `apps/web/.env.production` and `/etc/master-suite/backup.env`. **Never type, paste or echo a connection string, passphrase or token.** No command below needs one.
- Return only the redacted evidence named in each step. Stop at the first stop condition and report it.

## Setup, once per session

```bash
REPO_DIR=/path/to/the/deployed/checkout      # the clone release.sh runs from
APP_DIR="$REPO_DIR/apps/web"
cd "$APP_DIR/infra"
DC="docker compose --env-file ../.env.production -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.azure.yml"
[ -f docker-compose.small-host.yml ] && DC="$DC -f docker-compose.small-host.yml"   # release.sh adds it the same way

# The audits and the guarded restore check are not in the deployed commit.
# Take them from the checkpoint commit into /tmp. The working tree is not touched.
SHA=8c21f2790244592209c110e031e5e01ea331bc30
git -C "$REPO_DIR" fetch origin claude/restructure-foundation
rm -rf /tmp/rc-audit && mkdir -p /tmp/rc-audit
git -C "$REPO_DIR" archive "$SHA" \
  apps/web/scripts/rc-readonly.mjs apps/web/scripts/rc-preflight.mjs apps/web/scripts/rc-booking-audit.mjs \
  apps/web/scripts/rc-collections-legacy-audit.mjs apps/web/scripts/rc-post-deploy-delta.mjs \
  apps/web/scripts/restore-verify.sh apps/web/scripts/backup-ship.sh | tar -x -C /tmp/rc-audit --strip-components=3
sha256sum /tmp/rc-audit/*        # must match the table at the end

# One read-only script in the `migrate` service's image and environment.
# --no-deps: nothing else is started. --entrypoint node plus an explicit command: the
# service's own command (the staging check, then `prisma migrate deploy`) never runs.
AUDIT() { $DC --profile tools run --rm --no-deps --entrypoint node -v /tmp/rc-audit:/app/rc:ro migrate "rc/$1" "${@:2}"; }
```

**Why `migrate`, not `worker` or `web`.**

- The production overlay blanks the owner URL in `web` and `worker`, so an audit there exits.
- Their app role is filtered by row-level security. Measured locally, it counts 0 bookings where the owner counts 1.
- `migrate` is the only service given `.env.production` in full.
- At the deployed commit it builds from the `build` stage, which has `WORKDIR /app`, the full source and `node_modules`, `pg` included. Only `rc/` has to be mounted.
- If the host has no `migrate` image yet, the first `run` builds one from the checkout. That reads no data.

**What protects the result.** Every audit opens one read-only, repeatable-read transaction and prints the role it runs as. It then **exits 3 without printing any count** unless that role is superuser or bypasses row security. It also sets `row_security = off`, so a restricted role gets an error rather than a filtered number.

**Stop before step 1 if:**

- `git fetch` cannot find the branch. It has to be pushed first, and that is the owner's decision.
- Any checksum differs.
- `grep -c '^MIGRATION_DATABASE_URL=' ../.env.production` does not print `1`. It prints a count, never the value.
- `$DC ps --services --filter status=running` does not list `postgres`.

## Steps

| #   | Check                                   | When                                  | Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Expected                                                                                                                                                                                                                                                         | **Stop if**                                                                                                                                                                                                                              | Return                                                                                          |
| --- | --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0   | What is running                         | **Now**                               | `../scripts/release.sh status`, then `$DC ps --format '{{.Service}} {{.Status}}'`                                                                                                                                                                                                                                                                                                                                                                                                                             | current and previous tag per environment; the service list                                                                                                                                                                                                       | a tag nobody can account for                                                                                                                                                                                                               | tags and service list                                                                           |
| 1   | Preflight                               | **Now, baseline**                     | `AUDIT rc-preflight.mjs; echo exit=$?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | first line: the production database, `superuser: yes` or `bypasses row security: yes`; eight migrations listed as `PENDING`; `exit=0`                                                                                                                             | `exit=3` or any other non-zero exit; `unfinished migration rows` above 0; cross-workspace references; any rule that will start failing                                                                                                    | full output (counts and ids only)                                                               |
| 2   | Booking audit                           | **Now, baseline**                     | `AUDIT rc-booking-audit.mjs; echo exit=$?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `RESULT: clear to deploy`, `exit=0`                                                                                                                                                                                                                              | `exit=1`: a unit sold twice or a live confirmed booking with no unit, and deployment stays blocked until each row is decided; `exit=3` or any other exit                                                                                 | full output and exit code                                                                       |
| 3   | Collections legacy audit                | **Now, baseline**                     | `AUDIT rc-collections-legacy-audit.mjs; echo exit=$?`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `LEGACY STATE: the receipts table does not exist yet`, four sections, a `RESULT` line, `exit=0`                                                                                                                                                                  | `exit=3` or any other non-zero exit. Rows are **not** a deploy stop: every row in sections 1 to 3 is a sale, commission or payout finance must decide before release, because the candidate refuses to approve or pay them without verified receipts | full output (references and ids only)                                                           |
| 4   | Restore into an isolated target         | **Now, baseline** (root)              | `docker compose ... exec -T postgres psql -U leadflow -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE '%restorecheck%'"` (use `$DC`), then `systemctl start master-suite-backup-status.service; journalctl -u master-suite-backup-status.service -n 20 --no-pager`, then `systemd-run --wait --pipe --collect -p EnvironmentFile=/etc/master-suite/backup.env -p WorkingDirectory="$APP_DIR/infra" /bin/bash /tmp/rc-audit/restore-verify.sh --prefer-remote /var/backups/master-suite/latest; echo exit=$?` | no `restorecheck` database before; the status unit reports a recent backup, shipped; then `ok    restore target is a scratch database this script owns`, every `[verify]` line `ok`, `RESTORE VERIFIED (off-host copy)`, `dropping the scratch database this run created`, `exit=0` | any `REFUSED` line (live-database name, an existing target it did not create, a target in use, or a role that row security applies to); any `[verify] FAIL`; the backup is stale or was never shipped; `FIELD_ENCRYPTION_KEY` is missing from the secret store | the `restorecheck` query result; the 20 status lines; full restore output; key present in the secret store: yes or no |
| 5   | Alert delivery                          | **Now, baseline**                     | `$DC --profile observability exec alertmanager amtool alert add OperatorDeliveryDrill severity=info --annotation=summary="operator delivery drill" --end="$(date -u -d '+10 min' +%Y-%m-%dT%H:%M:%SZ)" --alertmanager.url=http://localhost:9093`                                                                                                                                                                                                                                                              | one email at the on-call address within 10 minutes. It is one real notification and changes no data                                                                                                                                                             | nothing arrives; `alertmanager` is not running; `amtool` is not found                                                                                                                                                                      | subject line and receive time                                                                   |
| 6   | Individual accounts                     | **Now, baseline** (read-only)         | `$DC exec -T postgres psql -U leadflow leadflow -Atc "SELECT r.key, count(*) FROM \"User\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE u.\"deletedAt\" IS NULL AND u.status = 'ACTIVE' GROUP BY 1 ORDER BY 1"`, then `-Atc "SELECT t.slug, count(*) FROM \"User\" u JOIN \"Tenant\" t ON t.id = u.\"tenantId\" WHERE lower(u.email) = 'demo@youhan.in' AND u.\"deletedAt\" IS NULL AND u.status = 'ACTIVE' GROUP BY 1"`                                                                     | active people per role; the workspaces where the demo login is active                                                                                                                                                                                          | a shared login in use for real work; `demo@youhan.in` active in any workspace other than the client demo                                                                                                                                  | per-role counts; demo-login workspace slugs; shared logins found: yes or no                     |
| 7   | Permission checks                       | **Final candidate, staging**          | with individual staging accounts: an agent records a receipt, expect 403; finance A records and A verifies, expect 403, then B verifies, expect 200; a director proposes a fee change and approves it, expect 403, then finance approves, expect 200; B builds a payout and approves it, expect 403, then A approves, expect 200                                                                                                                                                                                  | every status as written                                                                                                                                                                                                                                          | any 200 where 403 is written                                                                                                                                                                                                               | role, action and status for each                                                                |
| 8   | Compatible recovery rehearsal           | **Final candidate, staging**          | `../scripts/release.sh staging <final-sha>`; exercise a lead, a follow-up, a booking with a unit, a receipt with an uploaded document and its verification, and a fee amendment; `../scripts/release.sh rollback staging`; exercise the same; `../scripts/release.sh staging <final-sha>`; then `AUDIT rc-post-deploy-delta.mjs <deploy-instant>` with the staging env file in `DC`                                                                                                                              | under the old tag, only confirming without a unit and selling a sold unit fail; the candidate returns clean; the delta lists the rows written during the rehearsal                                                                                              | any other failure under the old tag                                                                                                                                                                                                        | pass or fail per action; delta output                                                           |

**Can run today against the current production baseline:** steps 0 to 6. **Must wait for the final candidate:** steps 7 and 8. Creating individual production accounts needs its own authorization and is not part of this list.

The weekly restore unit already on the host runs the deployed, unguarded script. Step 4's first query shows whether a `restorecheck` database exists that anything else could own.

## What was verified locally, and what was not

Verified against local databases, evidence in `validation-evidence/release-candidate/operator-commands-cfe582f.log`, `audit-legacy-and-rls-cfe582f.log` and `restore-guard-cfe582f.log`:

- The exact `AUDIT` command against an image built from the baseline commit's `migrate` service. It used `--no-deps` and `--entrypoint node`, and no other container of the project was created.
- Baseline shape without a receipts table: the legacy audit lists a legacy booking, commission and payout under `LEGACY STATE`.
- The app role stops with exit 3. With `row_security = off` that role gets an error, not 0. The read-only transaction refuses an UPDATE.
- Restore guards: an existing unmarked target, a target in use, a wrong live-database name and a restricted role are each refused with nothing dropped. An early failure leaves an existing target alone. A marked leftover is replaced, restored and dropped.

Not verified here:

- `amtool` inside `prom/alertmanager:v0.28.0`, because pulling the image was not authorized.
- The systemd units and `systemd-run` on the production host. The development machine is Windows.
- The `migrate` build on the production VM.
- The branch on the remote. It has not been pushed.

## Script checksums at the checkpoint commit

Output of `sha256sum /tmp/rc-audit/*` for the files taken from `8c21f2790244592209c110e031e5e01ea331bc30`. `restore-verify.sh` differs from `cfe582f` only in reading the dump checksum line in the form `backup.sh` writes it (`2fa097d`); the other six files are unchanged.

```text
17ac6918f10a3acc39c298acda5b52c3914ee4c14e00970e9596317d0c184ee8  backup-ship.sh
3b4ae48914d94d2ffe7e25facd44916d1dc8ecb087d503a06c8fc421e685b432  rc-booking-audit.mjs
810114869e76bf90e88d46f7b416e373a329bca4761f0f6f21290ecae9e80b8d  rc-collections-legacy-audit.mjs
cefbf191ed7c9c38a36cbf3b56f2125793563564b60c5c1038a1c52ceed6e4eb  rc-post-deploy-delta.mjs
65e784e1826160b221fd3e2f4340892f937e7ec48b82516f552150ec310d481e  rc-preflight.mjs
3e1df2732d048b1ed4668316055fdea7f538725f3b8100749040f732ec30a184  rc-readonly.mjs
40430079fa986d688aa81c06e42eeed4ade67f3146cc37ba4810a0ea8c6b82e9  restore-verify.sh
```
