# ADR 0001 — Archive the Python HRMS out of the repository

**Date:** 2026-08-08
**Status:** Accepted

## Context

`apps/hrms` held a FastAPI + SQLAlchemy + Alembic application: 85 tracked files
across `app/`, `alembic/`, `scripts/`, `web/` and 15 test modules. It was the
original HR product, and the merge that produced this platform reimplemented its
functionality as the People module of `apps/web`.

What remained was a copy that nothing ran and nothing referenced:

- No import, route, script or configuration anywhere in `apps/web` names it.
- `start.ps1` does not launch it, and `apps/web/infra/docker-compose.yml` builds
  `apps/face` but not `apps/hrms`.
- It carried its own SQLite database, `master_saas_hrms.db`, which was the
  concrete form of the "two databases" confusion the audit flagged: a second
  store of employee records that no longer received writes but still looked
  authoritative to anyone who opened the directory.
- Six `pytest-cache-files-*` directories and a 284 MB `.venv` had been committed
  to disk, along with `run.bat`, `tunnel.bat` and `reset_admin.py` — scripts that
  only ever worked on one machine.

Dead code of this size is not free. It doubles the apparent surface of the
repository, it is the first thing a new reader finds when looking for "where is
HR implemented", and a directory containing a working password-reset script and a
database file invites someone to run one of them.

## Decision

Move `apps/hrms` and `apps/Sales Lead Flow` out of the repository, to
`../archive/` alongside it:

```
Downloads/Master App/archive/master-saas-apps-hrms/
Downloads/Master App/archive/master-saas-apps-Sales-Lead-Flow/
```

All 139 files are preserved there, including `master_saas_hrms.db`,
`reset_admin.py`, `run.bat` and `tunnel.bat`. Only the regenerable artefacts were
discarded: the 284 MB `.venv` and the six `pytest-cache-files-*` directories.

`apps/face` stays. It is live — compose builds it and `FACE_SERVICE_URL` points
at it.

## Consequences

- `apps/` now contains exactly what the platform runs: `web` and `face`.
- The Python HRMS is still readable, still complete, and still comparable
  against `apps/web` — it is one directory away, not in the history.
- Independently of this archive, the untouched originals remain at
  `Downloads/Master App/HRMS` and `Downloads/Master App/Sales Lead Flow`. Note
  that they are *not* byte-identical to what was in the repository (165 files
  versus 139, with different `storage/` and cache contents), which is why the
  repository's own copy was archived rather than deleted in favour of them.
- `docs/FUNCTIONAL-PRESERVATION-MATRIX.md` refers to `apps/hrms` paths. Those
  references now point into the archive rather than into the repository. The
  matrix is a record of a comparison already made, so it has been left as
  written rather than rewritten to describe a directory layout that did not
  exist when the comparison was done.
- Reviving it means restoring a directory and rebuilding a virtualenv from
  `requirements.txt`. Nothing is lost; it simply stops being carried.
