# Finance package checkpoint: 14 September 2026

**Implementation checkpoint on the isolated branch `claude/restructure-foundation`.**

- Not merged, not deployed and not pushed.
- **Production remains NOT APPROVED.** Package 2 remains paused.

This checkpoint supersedes the gate and scope tables in `FINANCE-CHECKPOINT-2026-09-12.md`. That file stays as the record of the D-20, recovery-case and P&L work.

|                        |                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Artifact source        | `cfe582f9eed24d99c54c401f056ee841f255dfa0`                                                                 |
| Web image              | `master-suite/web:cfe582f`: `sha256:884e7bbb13289254495effc5bf5f838f4d6eb41f347a8c652beab5679049ce96`      |
| Worker image           | `master-suite/worker:cfe582f`: `sha256:96bcdb34ffc2c3ba57169f2b4acfb05d6ed4c1cda54aa04023c563b019eb3737`   |
| Image identity check   | both report `BUILD_COMMIT=cfe582f9eed24d99c54c401f056ee841f255dfa0` and `NODE_ENV=production`                |
| Test revision          | `d95092b937799918d0f9f491ede63d4218d00c60`. It differs from `cfe582f` only in `tests/e2e/collections-ui.spec.ts`; neither image has a `tests` directory |
| Documentation revision | the commit that adds this file. It changes only `docs/`, which no image or gate reads                     |

## 1. What changed since the last checkpoint

| Commit    | What                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `c1e1042` | Evidence upload on the receipt form (PDF, PNG or JPEG by content, malware-scanned, stored under the booking). Payroll grouped by placement in the pay period, with an "Unknown historical team" bucket.                                                        |
| `cfe582f` | Stricter historical placement after review. Audits run in one read-only transaction and refuse a role that row security applies to. The legacy audit handles the baseline without a receipts table. Restore verification guards its target. New tests. |
| `d95092b` | Test-only. The P&L browser check grants HR to its workspace and reads the API's report as returned. |

`c1e1042` passed all 16 Linux gates on its own images: `web:c1e1042` is `sha256:1ddfa909acd6b8f3ea36fe44143d1b56692c6e576a73863b9b7c74b7e6fe7223` and `worker:c1e1042` is `sha256:abbaf29019281bc181488bff58dbb19dd80528eda6de3a5a67e6c5e136fed177`. The log is `gates-linux-c1e1042.log` with SHA-256 `8d0da330…c635d`, and the unit suite had 2194 tests with none skipped. Another session's Playwright container, with its own database, was running for part of that run, so it was not strictly alone. Application source then changed in `cfe582f`, so that artifact is superseded, and every gate below was re-run on `cfe582f`.

## 2. Receipt evidence upload

| Requirement                                         | How it is met                                                                                                                                                                                  | Proven by                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Existing storage conventions                        | The same pipeline as other uploads: size guard, malware scan, object storage and a `Document` row. The key is `documents/t-<tenant>/booking-<booking>/…`.                                      | code review; unit tests                                                                                |
| Authorized upload and download                      | Upload needs `collections:CREATE`. Download needs `collections:VIEW`, and each download is audited.                                                                                            | unit: seller upload 403, seller download 403. Browser: seller download 403, verifier download 200     |
| Tenant boundary                                     | Documents are looked up by tenant. A document from one booking cannot be attached to another booking's receipt.                                                                                | unit: other workspace 404, other booking 404. Browser: an administrator of a second workspace gets 404 |
| Not reachable through the general document download | The lead-document download refuses the evidence category.                                                                                                                                     | unit: a `leads:VIEW` user gets 404                                                                     |
| File validation                                     | Only PDF, PNG and JPEG, recognised by content; malware refused.                                                                                                                                | unit: a text file named `.pdf` gets 422; EICAR gets 422 and no row is written. Browser: the error is shown |
| Failed-upload recovery                              | The error is shown beside the field and typed values are kept. If the database write fails after storage, the stored object is deleted.                                                       | browser: after a rejected file the amount is still filled in, then a valid PDF attaches               |
| Persistence                                         | The receipt stores the document id and the list links to it.                                                                                                                                   | browser: after a reload the row shows PENDING with its link, and the bytes download                    |
| Transaction-reference alternative kept              | Either a provider transaction id or a document satisfies the evidence rule.                                                                                                                    | existing receipt journeys use the transaction id; the new journey uses only a document                 |
| Upload never verifies money                         | Uploading returns a document id and nothing else. The receipt stays PENDING until a different person verifies it.                                                                              | unit and browser: status PENDING, no verifier                                                          |

Browser results, `d95092b` specs against the `cfe582f` artifact, are in §6 under gate 14.

## 3. Historical payroll placement

**The rule, after checking what the records can prove:**

- **`UserTeam.createdAt` is the time the row was inserted.** It is not an effective membership date. Nothing in the application sets it and no application path creates, updates or deletes a membership. Rows come from the seed or from database administration. The record carries no effective date, so the row is the only evidence of membership. A row created on or before the period start therefore means the records show the person in that team when the period began. A membership that began earlier in reality but was recorded later reads as Unknown, never as the wrong team.
- **Deletion and rejoin.** A re-created row carries a new `createdAt`, so a leave-and-rejoin during or after the period reads as joined later and gives Unknown. Deletions themselves leave no trace, so a second membership held during the period and deleted since cannot be seen. That is the stated limit of this rule. The upgrade is a membership history table, if memberships ever become editable in the application.
- **Multiple teams.** There is no payroll attribution rule for a person in two teams, so two memberships that span the period give Unknown. No team is picked.
- **Transfers and additions during the period.** Any membership created before the period ended but after it began gives Unknown, even when an older membership also exists.
- **Backdated payroll and unfinished periods.** Placement is established only once the period has ended. A payslip calculated before then gets no snapshot, and the report resolves it after the period ends by the same rule. A snapshot, once written, is never changed.
- **Branch and region** are used only if the user row has not been written since the period began.

**Amounts and totals.** Unknown payroll keeps its full amount in a row named "Unknown historical team", and it counts in the payroll total. The report returns `historicalPlacementUnknown` with a count and an amount. The screen shows the same count and amount above the table, and the caveat repeats them. **No P&L export exists.** The API is the machine-readable surface, and none was built.

| Case                                                                                                 | Result                          | Proven by                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| Joined after the period (backdated run)                                                              | Unknown                         | leadership unit test                                       |
| One membership from before, another added after the period                                           | the earlier team                | leadership unit test                                       |
| Team added during the period                                                                         | Unknown                         | leadership unit test                                       |
| Two memberships spanning the period                                                                  | Unknown                         | leadership unit test                                       |
| Period not yet ended                                                                                 | Unknown, then the team after it ends | leadership unit test                                  |
| User row changed after the period began                                                              | branch and region Unknown       | leadership unit test                                       |
| Payroll run calculated: joined 10 February gives no snapshot for February; a snapshot for May       | as stated                       | payroll unit test through `createRun` and `calculateRun`   |
| Unknown bucket amount, count, caveat and reconciled total                                            | as stated                       | leadership unit test                                       |
| Screen and API agree: one payslip of 12,345.67, and the API total equals the sum of its rows        | as stated                       | browser test, §6 gate 14                                   |

## 4. Operator commands, verified locally

The checklist is `OPERATOR-CHECKLIST.md`. It pins the scripts to `cfe582f` and lists their checksums. What was proven is below. Evidence logs are in `validation-evidence/release-candidate/`. Log files are git-ignored in this repository, so they stay on the validation machine and are identified here by name and SHA-256.

| Point                                                                                                                                                           | Result                                                                                                                                       | Evidence                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| The exact `migrate` command, against an image built from the **baseline** commit `f16ed67` with the production Compose files                                     | ran with `--no-deps --entrypoint node`. Working directory `/app`, Node 22.23.2, `pg` 8.22.0. No `rc-*` script is in the image, so the mount is required. No other service or container was created | `operator-commands-cfe582f.log`            |
| The service's own command                                                                                                                                         | `check-staging-first && prisma migrate deploy`, depending on postgres. The operator command overrides both, so no migration runs              | `operator-commands-cfe582f.log`            |
| Visibility under forced row-level security                                                                                                                        | the app role silently counted 0 bookings where the owner counted 1. The audits now exit 3 for such a role; with `row_security = off` that role gets an error | `audit-legacy-and-rls-cfe582f.log`, `audit-guards-host-cfe582f.log` |
| Read-only                                                                                                                                                         | an UPDATE inside the audit transaction is refused                                                                                             | `audit-legacy-and-rls-cfe582f.log`         |
| Baseline without the receipts table                                                                                                                               | `LEGACY STATE` is printed and the legacy booking, commission and payout are each listed. The result names the missing table                  | `operator-commands-cfe582f.log`            |
| Restore target guards                                                                                                                                             | refused with exit 1 and nothing dropped: an existing unmarked target, a target in use, a live-database name that does not exist, a role row security applies to. An early failure leaves an existing target alone. A marked leftover is replaced, restored and dropped, and the live database is untouched | `restore-guard-cfe582f.log`               |
| The earlier restore script                                                                                                                                        | dropped any `<db>_restorecheck` with forced disconnects, including on early exit. That is fixed at `cfe582f`. The deployed weekly unit still runs the old script until release, so step 4 of the checklist looks for a collision first | code review                                |

Log hashes, SHA-256: `operator-commands-cfe582f.log` `152a035f…`, `audit-guards-host-cfe582f.log` `c388d325…`, `audit-legacy-and-rls-cfe582f.log` `39a72e98…`, `restore-guard-cfe582f.log` `fbb143f7…`.

All local proofs used disposable, uniquely named databases, since dropped. No shared database, file or container was changed.

## 5. Acceptance criteria mapped to evidence

| Criterion                                                                         | Evidence                                                                                                               | Re-run at `cfe582f`?                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Every confirmed booking identifies one unit                                       | booking service and API tests; browser booking journeys; booking audit script                                           | yes, inside gates 12 and 14             |
| D-8: maker-checker receipts, required fields, 100% rule, reversals, recovery case | collections unit and route tests; finance browser journeys, desktop and Pixel 7                                         | yes, inside gates 12 and 14             |
| D-8: evidence by document or transaction id                                       | §2                                                                                                                     | yes, gates 12 and 14                    |
| D-20: fee proposal, approval by someone else, preview, recalculation, cases       | fee-amendment unit and route tests; browser journey                                                                    | yes, gates 12 and 14                    |
| Recovery cases: assign, acknowledge, recover, second-person write-off             | route tests; browser journeys                                                                                          | yes, gates 12 and 14                    |
| P&L: confirmed revenue, approved payroll, placement by period                     | §3                                                                                                                     | yes, gates 12 and 14                    |
| Legacy payouts treated as an operational migration issue                          | legacy audit, §4; checklist step 3                                                                                     | proven locally; production run pending  |
| Commission and payout paths enforce verified coverage                             | payout and commission unit tests                                                                                       | yes, gate 12                            |
| Tenant isolation and RLS coverage                                                 | gate 2 and tenant tests                                                                                                | yes                                     |
| Artifact runs in production mode                                                  | `NODE_ENV=production`, `BUILD_COMMIT`, development outbox 404, health 200 over TLS                                     | yes, on the `cfe582f` images             |

Not re-run, because nothing it depends on changed: the migration rehearsal (`receipt-fk-restrict-repro.log`, `fee-amendments-migration-evidence.txt`). No migration was added after `5898ec3`, and gate 1 shows no drift at `cfe582f`.

## 6. Gates at `cfe582f` and `d95092b`

Environments:

- **Linux:** a `node:24` container with its own `node_modules`, database `master_suite_ci`, run alone.
- **Windows:** loopback Postgres `master_suite_val` and Redis.
- **Browser:** Windows Chromium, through a TLS relay on 3443, to `rc-web` running `web:cfe582f` and `rc-worker` running `worker:cfe582f`. Both report `NODE_ENV=production` and `BUILD_COMMIT=cfe582f…`, the development outbox returns 404, and the scanner is the local ClamAV.

| #   | Gate                 | Revision                                     | Environment | Exit              | Result                                                                                                        | Log (SHA-256, first 8)                                                                                                  |
| --- | -------------------- | -------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Schema drift         | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | `gates-linux-cfe582f.log` (`23f62aec`)                                                                                  |
| 2   | Tenant isolation     | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |
| 3   | Raw SQL scope        | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |
| 4   | Typecheck            | `cfe582f`, then `d95092b`                    | Linux       | 0, 0              | PASS                                                                                                          | same; `gates-4-5-6-d95092b.log` (`9708c41c`)                                                                            |
| 5   | Lint                 | `cfe582f`, then `d95092b`                    | Linux       | 0, 0              | PASS                                                                                                          | same                                                                                                                    |
| 6   | Format check         | `cfe582f`, then `d95092b`                    | Linux       | 0, 0              | PASS                                                                                                          | same                                                                                                                    |
| 7   | README schema counts | `cfe582f`                                    | Linux       | 0                 | PASS; no schema change since `5898ec3`                                                                        | `gates-linux-cfe582f.log`                                                                                               |
| 8   | Observability drift  | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |
| 9   | Redis auth           | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |
| 10  | Face token           | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |
| 11  | Backup round trip    | `cfe582f`                                    | Linux       | 0                 | PASS, with the guarded restore script                                                                         | same                                                                                                                    |
| 12  | Unit suite           | `cfe582f`                                    | Linux       | **1**, then **0** | First run: 2197 passed, **1 failed** (a timeout, below). Re-run alone: **2198 passed, 0 failed, 0 skipped**   | `gate12-unit-detail-cfe582f-run1.log` (`3183395d`); `gate12-rerun-cfe582f.log` (`53dbdb17`); `gate12-unit-detail-cfe582f-rerun.log` (`504f2911`) |
| 13  | Integration (server) | `cfe582f`                                    | Windows     | 0                 | 6 passed of 6                                                                                                 | `gate13-integration-cfe582f.log` (`c81c3f35`)                                                                           |
| 14  | Browser and artifact | `d95092b` specs, `cfe582f` artifact          | Windows     | 0                 | **67 passed, 0 failed, 0 skipped**                                                                            | `gate14-e2e-d95092b.log` (`d2ec169a`)                                                                                   |
| 15  | Build                | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | `gates-linux-cfe582f.log`                                                                                               |
| 16  | Dependency audit     | `cfe582f`                                    | Linux       | 0                 | PASS                                                                                                          | same                                                                                                                    |

Gate 12 does not read the only file changed in `d95092b`, because the unit configuration excludes `tests/e2e`. Gate 13 reads only `tests/server`.

**16 of 16 pass on the final revisions.** Three failures happened on the way. All their logs are kept.

1. **Gate 12, first run.** In `css-tokens.spec.ts`, the test "are declared before they are used" exceeded its 30-second limit. It only scans `src` through the Windows bind mount, and its sibling test on the same scan passed. The file took 60 seconds at `c1e1042`, 77 on the first run and 76 on the re-run. It is **timing-sensitive** and can fail again under load. No code or test was changed for it; a fix is listed as open.
2. **Gate 14, first run** (`gate14-e2e-cfe582f-run1-scanner-unreachable.log`, `1adf0520`). The evidence upload failed because my environment file for the artifact containers selected ClamAV without a reachable host. The product refused to store the unscanned file and told the user so, which is the designed behaviour. The environment file was corrected; the image did not change.
3. **Gate 14, second run** (`gate14-e2e-cfe582f.log`, `1db3046a`). Both evidence journeys passed. The new P&L check failed for two reasons, both test mistakes fixed in `d95092b`: its workspace had no HR module, so the report rightly showed no payroll, and the check misread the API's response shape. The run in the table is the full re-run.

The `c1e1042` run in §1 was a full 16-of-16 pass on its own artifact, which is now superseded.

## 7. Remaining production checks and owners

| Item                                                                                             | Owner                                 | Can run now against the baseline?         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------- |
| Push the branch so the operator can fetch the pinned scripts                                     | repository owner                      | yes; it is not a merge or a deployment    |
| Checklist steps 0 to 3: status, preflight, booking audit, collections legacy audit               | authorized production operator        | yes                                       |
| Work the legacy audit's rows: record and verify real receipts, or withdraw the status            | finance                               | after step 3                              |
| Resolve any booking-audit rows: give each booking its unit or return it to draft                 | sales operations with finance         | after step 2                              |
| Step 4: restore into an isolated target with the guarded script                                  | authorized production operator (root) | yes                                       |
| Step 5: alert delivery                                                                           | authorized production operator        | yes                                       |
| Step 6: individual accounts review                                                               | authorized production operator        | yes                                       |
| Creating individual production accounts                                                          | workspace owner, separate authorization | not part of this checklist               |
| Steps 7 and 8: permission checks and compatible recovery rehearsal on staging                    | authorized operator with finance users | no, waits for the final candidate        |
| Production approval                                                                              | release owner                         | no                                        |

## 8. Schedule

**Provisional 3 to 5 working days to a release window.** This is a planning target, not a promised date. It holds only if the operator is available at once and the audits come back clean.

| Kind of effort                           | Estimate                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering                              | 0 days for known work. Up to 1 day for anything the audits surface that needs code; legacy rows need finance decisions, not code.                                                                  |
| Operator                                 | half a day for steps 0 to 6; half a day for steps 7 and 8 on staging.                                                                                                                              |
| Finance                                  | depends on the legacy audit. Zero rows means none. Each row needs a receipt recorded and verified by two people, or a withdrawn status.                                                             |
| Waiting                                  | branch push; operator availability; a backup new enough to restore; finance decisions. None of this is engineering time.                                                                          |

Re-estimate after steps 1 to 3 return. A large legacy list moves the window by as much time as finance needs for it, and nothing in engineering can shorten that.

## 9. Consolidated checklist

| Item                                                                                                                                                       | State                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Receipt evidence upload: authorization, tenant boundary, validation, failed-upload recovery, persistence, transaction-id alternative, no automatic verification | **Completed**; gates 12 and 14                                 |
| Historical payroll placement, checked against deletion, rejoin, multiple teams, backdating and mid-period transfers                                         | **Completed**; gate 12                                         |
| P&L Unknown historical team: same count and amount on screen, in the API and in the caveat; totals reconcile                                                | **Completed**; gates 12 and 14                                 |
| P&L export                                                                                                                                                 | **Not built.** None exists; the API is the machine-readable surface |
| Collections legacy audit on the baseline without the receipts table                                                                                        | **Completed**; proven locally                                  |
| Audits: read-only transaction, refusal of a restricted role, an error instead of a filtered zero                                                          | **Completed**; proven locally                                  |
| Exact `migrate` command against the baseline image, with nothing else started                                                                              | **Completed**; proven locally                                  |
| Restore target guards                                                                                                                                      | **Completed**; proven locally, and gate 11                     |
| Fresh candidate `cfe582f`: images, digests and all 16 gates                                                                                                | **Completed**; §6                                              |
| README and schema counts                                                                                                                                   | **Completed**; gate 7, no schema change                        |
| Timing-sensitive `css-tokens` unit test                                                                                                                    | **Open**; not fixed, recorded in §6                            |
| Branch pushed so the operator can fetch the pinned scripts                                                                                                 | **Pending**; the owner's decision                              |
| Production checklist steps 0 to 6                                                                                                                          | **Pending**; the authorized operator, runnable now             |
| Finance decisions on legacy-audit rows                                                                                                                     | **Pending** on step 3                                          |
| `amtool` present in the alertmanager image                                                                                                                 | **Not verified**; step 5 stops if it is missing                |
| Staging steps 7 and 8                                                                                                                                      | **Blocked** until a final candidate is chosen                  |
| Individual production accounts                                                                                                                             | **Blocked** on separate authorization                          |
| Merge, deployment, production approval                                                                                                                     | **Not started and not authorized**                             |
| Package 2                                                                                                                                                  | **Paused**                                                     |

Production remains NOT APPROVED. Package 2 remains paused. Nothing was merged or deployed, and nothing in production was changed.
