# Release candidate — attribution manifest

| Field | Value |
|---|---|
| Branch | `dev/yourhan-next` (non-default; `main` untouched) |
| Base | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Commit A | `f1c4d4b` — governance, tooling, test determinism, accessibility pilot |
| **Commit B / release candidate** | **`1f46c78a23689b404fb89a0cd8e83216128e4933`** — RC-4 |
| Date | 2026-09-08 |
| Push | **attempted, blocked by the environment** — see below |

## Attribution method

Not guessed. `specs/SPEC-0003-tablesearch-accessibility/execution/ASES-0001.json`
records `initialChangedPaths` captured at `startedFromCommit f16ed67`, before
any work in this engineering workstream began. That set **is** the pre-existing
dirty tree, and it is the authority used here.

**57 paths were already dirty**: 36 under `apps/web/src/`, 21 governance and
tooling paths from the earlier phases of this same workstream.

Two files under `apps/web/src/` were **not** in that set —
`components/workspace/TableSearch.tsx` and `services/hr/captureVault.ts` — and
they are exactly the two product files this workstream is entitled to change.

## Group A — release candidate (407 files)

| Category | Count | Notes |
|---|---|---|
| `docs/` — governance, standards, evidence | 201 | Phase A/B, all evidence packets |
| `specs/` — SPEC-0001…0006 | 133 | artefacts, sessions, verification and review records |
| `tools/` — SDD validator and agent control plane | 55 | B2/B3 suites included |
| `apps/web/tests/` | 9 | SPEC-0003/0004/0005/0006 |
| `apps/web/scripts/` | 2 | `prepare-test-db.mjs` (new), `generate-secrets.mjs` |
| `apps/web/src/` | **1** | **`components/workspace/TableSearch.tsx` only** |
| root and CI | 5 | `AGENTS.md`, `CLAUDE.md`, `sdd.config.json`, `.github/workflows/sdd-validate.yml`, `apps/web/SETUP.md` |
| `apps/web/package.json` | 1 | two script entries; no dependency change |

Plus commit B's two files: `apps/web/src/services/hr/captureVault.ts` and
`apps/web/tests/unit/capture-vault.spec.ts`.

## Group B — pre-existing user/UI redesign (36 paths, PRESERVED)

Untouched, unstaged, uncommitted. Still dirty in the working tree exactly as
they were found.

34 modified files across `src/app/`, `src/components/`, `src/lib/nav/` and
`src/styles/`, plus two untracked paths:
`src/app/(workspace)/[workspaceSlug]/ai/` and `src/lib/nav/modKey.ts`.

## Group C — unknown attribution: **0**

Every path in the working tree resolved to A or B from session evidence. Nothing
was staged on a guess.

## Verification performed before and after staging

| Check | Result |
|---|---|
| `git add .` / `-A` / `--all` used? | **NO** — every path staged explicitly |
| Staged files under `apps/web/src/` | **1** — `TableSearch.tsx` |
| Pre-existing redesign paths staged | **0**, cross-checked programmatically against the 36 |
| `node_modules`, `.next`, `dist`, `.log`, `.env` staged | **0** |
| Dirty files remaining after both commits | **36** — and 0 of them outside `apps/web/src/` |
| Required RC-4 files omitted | **none** — both committed in B |

The last two rows are the important pair: everything of mine is committed, and
everything of the user's is still exactly where it was.

## Post-commit verification

| Check | Result |
|---|---|
| Capture-vault targeted | **28 / 28 PASS** |
| B2 validator suite | **93 / 93** |
| B3 agent suite | **70 / 70** |
| `validate --all` | **0 errors**, 7 historical warnings |
| Full suite ×3 | **reused** — 1935 / 1933 / 0 / 2, three runs. Committing changed no source content |

## Push — attempted and blocked

`git push origin dev/yourhan-next` was attempted and **denied by this
environment's permission layer**, as was `git remote -v`. This is not a
credential problem and not a decision to skip the step.

**Operator command:**

```bash
git push origin dev/yourhan-next
```

Expected to push `f1c4d4b` and `1f46c78` onto the existing non-default branch.
**No force. No merge to `main`. No tag.**

## What cannot follow until the push lands

| Step | Blocked by |
|---|---|
| CI evidence tied to `1f46c78` | the push; then `gh` authentication to read it |
| Staging deployment | `gh workflow run deploy.yml -f environment=staging -f action=deploy -f ref=1f46c78` — needs `gh` auth and `DEPLOY_*_staging` secrets |
| Staging verification | the deployment |

`gh auth status` reports not logged in on this workstation, so even after a
push the run status cannot be read from here.
