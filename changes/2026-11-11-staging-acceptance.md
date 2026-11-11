# Staging acceptance, as a script that can refuse

## What

`docs/release/staging-acceptance.sh` — the step that writes
`$STATE/tested.<tag>`. On the branch `release/staging-acceptance`.

## Why

`production-release.sh` refuses to deploy without `$STATE/tested.<tag>`
(lines 92, 169, 197), and **nothing in the repository ever wrote that file**.
The gate was therefore passable in exactly two ways: type the file by hand, or
skip the gate. Both defeat the point of having one, and a marker typed by hand
asserts an acceptance that may never have happened.

The owner authorised dedicated test accounts and synthetic records in an
isolated staging workspace, one account permitted and one that must be refused,
on controlled test inboxes.

## Where

- `docs/release/staging-acceptance.sh` — isolation guard, §6b smoke, rollback
  rehearsal, marker. LF, `bash -n` clean, `chmod +x`.

## Behaviour

Run on the staging host as the account owning the stack:

```
./staging-acceptance.sh <CANDIDATE_SHA>
```

It refuses, rather than warns, unless staging is provably not production:
the database name is a staging one and is not `leadflow`; `APP_ENV=staging`;
the live database answers with its own name when asked, rather than being
trusted from a string; staging's postgres is a different container from
`infra-postgres-1`; `SMTP_HOST` is Mailpit or loopback, so synthetic accounts
cannot email real addresses; and it will not act on a container named `infra-*`.

Then: pull the candidate images and record their **ids**, not their tags;
migrate staging first and assert nothing is unfinished or rolled back; start
the candidate and check the running image id equals the accepted one; §6b with
a workspace and administrator it creates itself; a second workspace's
administrator refused that first workspace's record on both read and write;
the worker's sweeps; a clean document round-tripped byte-for-byte. Then the
rollback rehearsal — the previous image on the candidate schema, `/api/health`,
`/login`, and zero prisma/error lines from the worker — and only then the
marker.

Secrets are read from the staging env file by the script and never printed.
The generated account passwords are written to a root-only
`$STATE/acceptance-accounts.<tag>`, so nobody has to invent credentials.

## Verified

- `bash -n` clean; LF asserted by `tests/unit/shell-line-endings.spec.ts`.
- Every endpoint it calls was checked against the routes in this tree.
  Two were wrong in the first draft and are corrected here: `/api/v1/leads`
  takes **no** `workspaceSlug` (the route reads the tenant from the session),
  and there is **no** `POST /api/v1/platform/users` at all — only
  `platform/users/[userId]`. The denied account is therefore a second
  workspace's administrator, which is the stronger check anyway.
- **Not executed.** It needs the staging host, which this session has no access
  to, and production must never be reached from here.

## Left open

The run itself. `84d71629` carries no migrations, so step 3 applies nothing and
the rollback rehearsal is trivially safe for that candidate — but the script
does not assume it and checks anyway.
