# Original application baseline test results

Date: 2026-08-03

## HRMS

Command:

```powershell
cd "C:\Users\admin\Downloads\Master App\HRMS"
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests
```

Result: **288 passed, 18 setup errors, 2384 warnings** in 590.76 seconds.

The 18 errors are not assertion failures. Pytest was denied access to its Windows
temporary directory while creating `tmp_path` fixtures. They are confined to:

- one `test_face_engine.py` case;
- five `test_face_punch_e2e.py` cases;
- twelve `test_face_vault.py` cases.

The first unscoped run also tried to collect an inaccessible stale
`pytest-cache-files-*` directory, so authoritative runs must target `tests` and
disable or redirect the cache. A green release baseline still requires rerunning
the 18 affected cases with a workspace-owned `--basetemp` directory.

## LeadFlow

First command (`npm test -- --run`) result: 14 tests passed; three suites could not
collect because the original command did not load required environment variables.

Authoritative baseline command:

```powershell
cd "C:\Users\admin\Downloads\Master App\Sales Lead Flow"
node --env-file=.env node_modules/vitest/vitest.mjs run
```

Result: **22 passed, 28 failed** across 50 tests.

Observed failure classes:

- route-handler helpers call `cookies()` outside a Next.js request scope and
  return 500;
- mutation/report/export/webhook helpers return hard-coded 501 responses;
- several tests assume response bodies after the request-context failure;
- the soft-delete fixture itself performs an update without the required tenant
  filter and trips the tenant guard;
- the RLS test sends two SQL statements in one prepared query and PostgreSQL
  rejects it with `42601`.

Passing baseline coverage includes all 8 consent validation tests, all 6 call
tenant/schema tests, and 8 additional permission/guard checks. The original
LeadFlow test suite is not a green regression gate and must not be represented as
one.

## Existing unified vertical test

`apps/web/tests/integration/unified-saas.spec.ts` previously passed the narrow
owner → workspace → administrator → department → employee → basic lead scenario,
module denial, suspension and core RLS denial. It does not cover opportunity,
leave approval, attendance parity, documents, the complete LeadFlow pages or the
original HRMS workflows. It remains useful as a platform slice, not as functional
preservation proof.

## Browser-verified vertical milestone

The approved narrow milestone was also exercised through the visible workspace
UI on 2026-08-03:

1. company administrator `Amina Al Rashid` opened Manath Homes;
2. created employee `Browser Preservation Employee` (`BROWSER-msd7ejg5`);
3. opened the workspace Sales lead page;
4. created `Browser Preservation Lead Verified` (`LEAD-000503`);
5. assigned that lead to the newly created employee;
6. verified both records resolve to tenant `cmsda4cwl0082z8lystvpg84l`, whose
   workspace slug is `manath-homes`.

The browser run exposed and fixed three narrow integration defects:

- empty optional form values are now omitted, preventing blank optional dates
  from becoming invalid dates;
- the form captures its element before awaiting the request, preventing a
  successful save from being displayed as a connection failure;
- API routes without dynamic path parameters now safely use an empty parameter
  object, restoring the original LeadFlow notifications request.

Evidence: `docs/evidence/vertical-milestone-current.png`. This proves only the
approved shared-identity/shared-workspace slice. It does not change the honest
preservation status of the remaining HRMS and LeadFlow features.
