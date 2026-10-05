# Two specs that failed only in parallel

**What.** `platform-break-glass.spec` and `prisma-config.spec` failed now and
then in a full run and passed alone. Fixed in #125, test files only.

**Why.**

- The break-glass gauge test counted live grants platform-wide before and after
  opening one. Eight other spec files open and revoke grants in parallel, so the
  delta moved by one. It now asserts "at least this grant": a blind gauge — no
  `withPlatformTx` under row-level security — still reads 0 and fails.
- The prisma-config test timed out (30 s) on the cold import of `prisma/config`
  under load. It now mocks that pass-through; the expression under test, in
  `prisma.config.ts`, is unchanged.

**Verified.** Both specs alone; the count test fails when the gauge is forced to
0; the full suite twice in a row.

**Lesson.** A test that counts rows across tenants cannot assert an exact
delta while the suite runs in parallel. Assert the property it protects.
