# Git history remediation — face photographs

## Current state

`apps/hrms/tests/faces/lena.jpg` and `messi.jpg` were removed from the working
tree and the index on 2026-08-05.

**They are still present in Git history.** No history-rewrite command has been
executed. Both blobs remain reachable from the initial commit:

```
8d42c51 Initial commit: Master SaaS unified HRMS + Sales platform
  f06aa74a57ce3a4129340cd4407ef3c0558e3193  apps/hrms/tests/faces/lena.jpg
  cd437610fe392d3ca892f62e26c33521f5147295  apps/hrms/tests/faces/messi.jpg
```

Anyone who clones this repository still receives both images.

## Is the repository public, shared or widely cloned?

Observed, not assumed:

| Signal | Value | Meaning |
|---|---|---|
| Configured remotes | **0** | Never pushed anywhere. Not on GitHub or any host. |
| Branches | 1 (`master`), no remote-tracking | No fork or PR history. |
| Repository created | 2026-08-05 20:29 | Hours old at the time of writing. |
| Commits | 2 | Initial commit plus one hardening commit. |

**Assessment: local-only, not public, not externally shared, minimal
distribution.** The repository has never been pushed, so no copy exists on a
hosting service.

**One caveat, stated because it is not verifiable from inside the repository:**
the initial commit was authored by `GreenArrow-7`, not by whoever is reading
this. At least one other person has worked in this tree. Confirm with them
whether they hold a separate clone, a backup, or an archive of the working
directory before concluding that rewriting history is sufficient.

## Is a rewrite warranted?

**Yes, and now is the cheapest it will ever be.** The usual argument against
rewriting — that it breaks every existing clone and requires coordinating
everyone — barely applies to a two-commit, never-pushed repository. That
calculus reverses permanently the first time this is pushed to a shared host.

The content itself justifies it: both files are photographs of identifiable
people committed without any consent record. "Lena" carries the additional
history of being a crop of a 1972 Playboy centrefold, used for decades without
the subject's meaningful consent, which the subject has since asked be retired.

**Recommendation: rewrite before the first push to any shared remote.**

## Procedure — NOT executed, run deliberately

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

## If a rewrite is declined

Record the decision and its owner here, along with the reasoning. The images
remain retrievable by anyone with a clone, and that should be a decision someone
made rather than something that happened by default.

| Decision | Owner | Date | Reasoning |
|---|---|---|---|
| | | | |
