# 28/28 baseline — verified evidence

Captured 2026-08-05. Everything below was executed, not asserted.

## Provenance caveat

The repository was initialised and all 465 files committed as a single
"Initial commit" by **GreenArrow-7** at 2026-08-05 20:29, concurrently with this
work. The HRMS implementation is inside that commit rather than in commits of
its own, so **there is no per-feature commit history for the HRMS migration**.
The working tree was already clean when this baseline was captured.

## Automated results

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0, no errors |
| `vitest run` (15 files) | 143 tests: 142 passed, 0 failed, 1 skipped |
| HR control tests | 52 passed (attendance 25, rules 15, settings 12) |
| `prisma migrate status` | 10 migrations, database schema up to date |

The one skipped test is `permission/engagement-modules.spec.ts › calls and events
permission catalogue…`, which belongs to the concurrent Sales work stream, not to
HRMS.

## Source-control hygiene

| Check | Result |
|---|---|
| Real `.env` tracked | No — ignored correctly |
| Committed env files | `.env.example` files and `apps/web/.env.test` |
| `.env.test` contents | localhost placeholders only (`test-secret`, `test-session-secret-…`) |
| AWS keys / private keys / tokens | None found |
| Employee documents, attendance captures | None — `**/storage/` and `*.db` are ignored |

**Two items to resolve, neither a secret:**

1. `apps/hrms/tests/faces/lena.jpg` and `messi.jpg` are photographs of real,
   identifiable people committed as biometric test fixtures. They are not
   employee data, but they are face images in source control, and "Lena" is a
   deprecated test image the imaging community has moved away from for consent
   reasons. `apps/hrms` is documented as vestigial; these should go with it.
2. `apps/web/.env.test` hardcodes local development credentials. Harmless
   against localhost, but they must never be reused for any deployed environment.
