# CI format remediation — PR #46

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| PR | #46 (draft, base `main`, head `dev/yourhan-next`) |
| Trigger | GitHub-hosted CI `verify` job failed on `e620171` |
| Classification | **TEST INFRASTRUCTURE / GOVERNANCE** — not a product regression |
| Prepared by | AI agent |

## 1. The failure, from CI as authority

Workflow `CI` (`.github/workflows/ci.yml`), job `verify`, step **Format check**,
which runs `npm run format:check` → `prettier --check .` from `apps/web`.

```
[warn] scripts/prepare-test-db.mjs
[warn] SETUP.md
[warn] tests/e2e/tablesearch-a11y.spec.ts
Code style issues found in 3 files. Run Prettier with --write to fix.
```

| Path | Rule | Workstream file? |
|---|---|---|
| `apps/web/scripts/prepare-test-db.mjs` | `prettier` — `printWidth: 120` | yes — SPEC-0004 (`CONV-005`) |
| `apps/web/SETUP.md` | `prettier` — markdown table padding, emphasis marker | yes — SPEC-0004 |
| `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | `prettier` — `printWidth: 120` | yes — SPEC-0003 |

All three are files this workstream authored. No pre-existing repository file
was implicated, and none was touched.

## 2. Why local checks never caught it — BUG-003, now proven

The repository has no `.gitattributes`, and this workstation runs
`core.autocrlf=true`. Every checkout materialises CRLF; prettier's `endOfLine`
default is `lf`. So a local `prettier --check .` flags essentially the whole
tree, and **three genuine violations were invisible inside ~900 false ones**.

Measured on one identical commit (`63daf3d`), varying only the checkout filter:

| Materialisation | `prettier --check .` |
|---|---|
| CRLF (`core.autocrlf=true`, the normal local checkout) | `Code style issues found in 902 files` |
| LF (`core.autocrlf=false`, what CI's Ubuntu runner gets) | `All matched files use Prettier code style!` |

That is the whole of BUG-003: a **Windows checkout artefact, not a repository
defect**. The committed blobs were already LF — `git` normalised them on `add`.
The local check is the thing that is wrong, not the tree.

**This is why the RC's format defect reached CI.** The noise floor hid it. The
durable fix is a `.gitattributes`, which is out of scope here and is recorded
against `BUG-003` rather than smuggled into a CI remediation commit.

## 3. The correction

Made in a **clean temporary worktree** created from `e620171`, so the
requester's working tree — 36 preserved redesign files plus local commit
`a04c7e3` — was never touched, staged, reset or stashed.

Applied the repository's own prettier, to the three named files only. No
`prettier .`, no `--fix` sweep, no line-ending normalisation, no `git add .`.

```
commit 63daf3da3fff00366cee9680c520d955e427c0cf
parent e620171db5f83b1836be62bb56c5de5569e04470
3 files changed, 16 insertions(+), 17 deletions(-)
```

### Formatting-only, proven at character level

Non-whitespace character deltas across the entire commit:

| File | Delta | Meaning |
|---|---|---|
| `SETUP.md` | +50 `-`, 4 × `*`→`_` | table separator padding; prettier's emphasis marker. Renders identically. |
| `prepare-test-db.mjs` | +1 `,` | `trailingComma: "all"` on a wrapped argument list. Inert. |
| `tablesearch-a11y.spec.ts` | −1 `,` | trailing comma dropped when `{ page }` collapsed to one line. Inert. |

No identifier, string literal, argument, assertion or test title changed.

| Dimension | Change |
|---|---|
| semantic code | **NO** |
| behaviour | **NO** |
| test expectation | **NO** |
| security control | **NO** |
| schema | **NO** |
| migration | **NO** |

Reinforced by git tree hashes, which are **identical** at `e620171` and
`63daf3d`:

| Tree | Hash at both commits |
|---|---|
| `apps/web/src` (all product source) | `82f5ae2204e82a4364c786d200fe25491ab346cf` |
| `specs` | `f5341a364c48ac2aba172807f1e7a1595fc8b3d5` |
| `tools/sdd` | `d170081a3a2ec9e5a1c1b4f1ea95bd6477b090a0` |

Product source is bit-identical. **RC-4 is carried forward unmodified.**

## 4. Verification

| Check | Result |
|---|---|
| `prettier --check .` on LF bytes, whole `apps/web` | **PASS** — "All matched files use Prettier code style!" |
| `validate --all` | **PASS** — 0 errors, 7 pre-existing `SDD-V064` warnings |
| B2 `tools/sdd/tests/validator.test.mjs` | **93 / 93** |
| B3 `tools/sdd/tests/agent.test.mjs` | **70 / 70** |

B2/B3 exercise only `tools/sdd`, whose tree hash is unchanged — so they are
unaffected by construction, and the numbers match the previously recorded ones.

Targeted product tests were **not** re-run, deliberately: `apps/web/src` is
bit-identical, so there is nothing new for them to exercise. The one changed
test file is covered by CI's own E2E step.

## 5. Release candidate identity

| Stage | SHA | Disposition |
|---|---|---|
| Initial CI candidate | `e620171` | **SUPERSEDED** — `sdd-validate` SUCCESS, `verify` FAILED (Format check) |
| **Current release candidate** | **`63daf3d`** | **CI GREEN** — both required checks pass |

`e620171` is no longer the canonical RC and must not be deployed. Any staging
or production deployment uses the SHA that passes CI, not the one that failed.

## 6. What was deliberately not done

- No repository-wide formatting. No `prettier .`, no `eslint --fix .`.
- No `.gitattributes` added — the correct BUG-003 fix, but a separate change.
- The requester's 36 redesign files and `a04c7e3` were not included; `a04c7e3`
  is confirmed **not** an ancestor of `63daf3d`.
- No force push. The update was a fast-forward `e620171..63daf3d`.
- PR #46 not merged. No deployment.

## 7. CI result on the new release candidate

| Workflow | Run | SHA | Job | Conclusion |
|---|---|---|---|---|
| SDD validation | `34247053372` | `63daf3d` | `validate` | **SUCCESS** |
| CI | `34247053426` | `63daf3d` | `verify` (14m03s) | **SUCCESS** |

All thirty `verify` steps passed, including **Format check**, Typecheck, Lint,
Schema drift, Tenant isolation, Raw SQL scope, Backup round trip, Test,
Integration, **E2E**, Build and Audit.

**BUG-006 did not reproduce.** The E2E step passed on the Linux runner. This is
consistent with the defect being a cold-spawned-server condition on Windows and
does not close it — `SPEC-0006` keeps it `OPEN`, because one green run on a
different platform is not proof the condition is gone.

**The product suite passing on a Linux runner is independent POSIX evidence for
RC-4**, obtained from CI rather than from the hand-built container used earlier.

## 8. Staging cannot proceed — infrastructure, not governance

Checked with repository **admin** rights, so this is absence, not blindness:

| Query | Result |
|---|---|
| `repos/.../actions/secrets` | `total_count: 0`, names `[]` |
| `repos/.../environments` | `total_count: 0` |

`deploy.yml` requires `DEPLOY_HOST_<ENV>`, `DEPLOY_USER_<ENV>` and
`DEPLOY_KEY_<ENV>` per environment, and its own header records that none exist
yet. A staging dispatch would fail at preflight.

**No staging deployment was attempted**, because firing a workflow to discover a
known-missing secret is not evidence-gathering.

This also constrains the production-incident thread: a repository with zero
deploy credentials and zero configured environments has never released through
this pipeline. That does not prove no production exists by other means — it does
mean **no staging target is reachable from here**, and staging was the required
gate between CI and production.
