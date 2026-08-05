# Git history remediation — face photographs

## Status: COMPLETED

`apps/hrms/tests/faces/lena.jpg` and `messi.jpg` were removed from the working
tree and index on 2026-08-05, and **removed from Git history on the same day by
an executed `git filter-repo` run**.

### What was executed

```
git clone --mirror master-saas ../master-saas-history-backup-20260805-212249.git
git filter-repo --invert-paths --path apps/hrms/tests/faces/ --force
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Verification after the run

| Check | Result |
|---|---|
| `git rev-list --objects --all \| grep faces/` | no match |
| `git cat-file -e f06aa74a…` (lena blob) | unreachable |
| `git cat-file -e cd437610…` (messi blob) | unreachable |
| `git count-objects -v` | 0 loose, 0 garbage, 764 in-pack |
| Tracked files | 484, faces/ absent |
| `tsc --noEmit` | exit 0 |
| `vitest run` | 18 files, 168 tests, 0 failed |

### Commit hashes changed

Every commit was rewritten. Anything quoting an old hash is now stale.

| Commit | Before | After |
|---|---|---|
| Initial commit | `8d42c514` | `15a1d567c243e640298dfd0fe445b6d8b0e419ef` |
| Pre-production hardening | `289d14ba` | `21fb6a3f` |
| Remove face photographs | `3170f6d3` | `510c3c1578edd2f564609dbd33d941ee4e48df55` |

Both tags were rewritten by filter-repo and still point at the intended commits:

| Tag | Points at |
|---|---|
| `hrms-28of28-baseline` | the initial commit (`15a1d56`) |
| `hrms-28of28-hardening-wip` | the hardening commit (`21fb6a3`) |

### Backup

A full mirror of the pre-rewrite history — including both blobs — is at
`../master-saas-history-backup-20260805-212249.git` (3.6 MB), alongside a copy of
the untracked `apps/web/.env` in `../env-backup-20260805-212249/`.

**That backup still contains the photographs.** It exists so the rewrite is
reversible while it is still being reviewed. Once the rewrite is accepted,
**delete the backup** — otherwise the images simply live somewhere else and
nothing has actually been achieved.

### Consequences for anyone else holding a clone

The repository had **zero remotes** and was never pushed, so there is nothing to
force-push and no host-side cache or fork to worry about. However, the initial
commit was authored by `GreenArrow-7`: if that person holds a separate clone or
an archive of the working directory, **it is now incompatible with this one and
still contains the images**. They must delete it and take a fresh copy; pulling
will not converge.

## Original assessment (retained for the record)

### Was a rewrite warranted?

**Yes, and it was the cheapest it would ever be.** The usual argument against
rewriting — that it breaks every existing clone and requires coordinating
everyone — barely applies to a two-commit, never-pushed repository. That
calculus reverses permanently the first time this is pushed to a shared host.

The content itself justifies it: both files are photographs of identifiable
people committed without any consent record. "Lena" carries the additional
history of being a crop of a 1972 Playboy centrefold, used for decades without
the subject's meaningful consent, which the subject has since asked be retired.

**Recommendation at the time: rewrite before the first push to any shared
remote. This was carried out.**

## Procedure, as documented and executed

`git filter-repo` is the tool the Git project recommends; `filter-branch` is
deprecated and mangles this case. Install it first (`pip install git-filter-repo`).

```bash
# 0. Work on a copy. filter-repo rewrites in place and there is no undo.
cd "/path/to/Master App"
cp -r master-saas master-saas.backup-$(date +%Y%m%d)

cd master-saas

# 1. Confirm exactly what will be removed, and that nothing else matches.
git log --all --oneline -- 'apps/hrms/tests/faces/*'
git rev-list --objects --all | grep -E 'faces/(lena|messi)'

# 2. Remove both paths from every commit.
git filter-repo --invert-paths \
  --path apps/hrms/tests/faces/lena.jpg \
  --path apps/hrms/tests/faces/messi.jpg

#    Or remove the whole directory, which is the safer choice here because it
#    also catches any earlier name the files may have had:
# git filter-repo --invert-paths --path apps/hrms/tests/faces/

# 3. Verify the blobs are gone.
git rev-list --objects --all | grep -E 'faces/(lena|messi)' && echo 'STILL PRESENT' || echo 'removed from history'
git cat-file -e f06aa74a57ce3a4129340cd4407ef3c0558e3193 2>/dev/null && echo 'blob still reachable' || echo 'blob unreachable'

# 4. Expire the reflog and repack so the objects are actually dropped from
#    this clone rather than merely unreferenced.
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 5. filter-repo deliberately drops the origin remote. Re-add it afterwards.
git remote add origin <url>     # only if a remote is intended

# 6. Re-verify the tree still builds and tests still pass.
cd apps/web && npm ci && npx tsc --noEmit && npx vitest run
```

### Afterwards

- **Tags are rewritten too.** `hrms-28of28-baseline` and
  `hrms-28of28-hardening-wip` will point at new commit hashes. Re-verify they
  still mark the intended state, and update any document quoting a commit SHA —
  including `docs/evidence/baseline-28of28/baseline-commit.txt`, which records
  `8d42c51`.
- **Every existing clone becomes incompatible.** Anyone holding one must delete
  it and re-clone; pulling will not converge. With no remote and one other known
  participant, that is a single conversation.
- If the repository is ever pushed *before* the rewrite, this becomes a
  force-push plus a coordinated re-clone by everyone, and any host-side cache,
  fork or pull request may retain the blobs regardless. Do it first.

## Remaining actions

| # | Action | Owner | Done |
|---|---|---|---|
| 1 | Delete `../master-saas-history-backup-20260805-212249.git` once this rewrite is accepted — it still contains both photographs | | ☐ |
| 2 | Delete `../env-backup-20260805-212249/` (holds a copy of the untracked `.env`) | | ☐ |
| 3 | Confirm with `GreenArrow-7` whether a separate clone or working-directory archive exists; if so, it still contains the images and must be destroyed and re-taken | | ☐ |
| 4 | Re-run `npm run check:test-data` in CI on every build so this cannot recur | | ☐ |
