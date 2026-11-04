# Any `.env.<suffix>` is ignored, not three guesses at what a backup is called

**What.** `.gitignore` gains `**/.env.*`, with `**/.env.example` and
`**/.env.*.example` excepted so the templates stay tracked.

**Why.** Setting up the acceptance rig, `apps/web/.env` was copied to
`apps/web/.env.qa-backup` before being edited. That name matches none of the
three patterns already there — `.env.bak*`, `.env.*.bak`, `*.env.bak` — so a
`git add -A` swept it into a commit and it reached a pushed branch carrying
`PLATFORM_OWNER_PASSWORD`, `FIELD_ENCRYPTION_KEY`, `METRICS_TOKEN`,
`REDIS_PASSWORD` and the MinIO access pair.

The comment above those three patterns already says what this costs: "Secrets
in git history cannot be taken back." They were written after the same mistake
with a different suffix. A list of guessed names is the wrong shape for this —
the rule now covers the whole family and names the exceptions instead.

**Where**

- `.gitignore` — the `**/.env.*` rule and its two negations.

**Behaviour.** `apps/web/.env.qa-backup` and anything like it is untracked;
`git check-ignore -v` confirms the rule that catches it. The `.env.example`,
`.env.production.example`, `.env.staging.example` and `.env.test.example`
templates are still tracked, confirmed the same way.

**Verified.** `git check-ignore -v apps/web/.env.qa-backup` names
`.gitignore:61:**/.env.*`; the same command on `apps/web/.env.production.example`
matches nothing.

**Also.** The blob was removed from the branch's history, and the work was
re-opened as a new branch so no published ref had to be rewritten. The two
branches that still carry it — `fix/ai-credential-policy` and
`fix/ai-error-diagnosis`, behind #244 and #243 — must be closed unmerged and
deleted rather than merged. The values are the local scratch rig's own
generated ones (Postgres and Redis on `127.0.0.1`, MinIO defaults, an owner
password for a disposable database); any that were copied from production
should be rotated.
