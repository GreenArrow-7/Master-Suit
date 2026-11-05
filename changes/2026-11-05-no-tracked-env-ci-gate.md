# CI asks the index, not `.gitignore`, whether an environment file is tracked

**What.** The `verify` job's first step after checkout fails the run if any
tracked path is an environment file. `.env.example` and `.env.<any>.example`
are the only exceptions.

**Why.** `.gitignore` had just been widened to `**/.env.*` after
`apps/web/.env.qa-backup` reached a pushed branch
([entry](2026-11-05-env-backup-ignored.md)). That rule is still only advice:
`git add -f` walks past it, and so does a path an earlier commit already
tracked, which is exactly the shape of the incident — the file was staged
before any rule covered its suffix. An ignore rule cannot answer "is one
tracked right now"; `git ls-files` can, and does not depend on guessing the
next suffix somebody invents.

Placed before `setup-node` so it costs a few seconds and fails before any
build work.

**Where**

- `.github/workflows/ci.yml` — the `No .env file is tracked` step.

**Behaviour.** A push or PR carrying a tracked `.env`, `.env.local`,
`.env.qa-backup` or any similar name fails CI with the offending paths named
and a note to rotate what they carried. The templates stay green.

**Verified.** The step's command run locally over `main` prints
`no tracked .env files`; run over `origin/fix/ai-error-diagnosis` — the branch
that carries the incident file — it names `apps/web/.env.qa-backup` and exits
non-zero.

**Left open.** Repository secret scanning is disabled
(`/secret-scanning/alerts` → 404), so this is the only automated check. Turning
GitHub's own scanning and push protection on is an owner action and would catch
key material in files this step does not look at.
