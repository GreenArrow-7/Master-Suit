# Release 1dddaf9

**What.** Production moved from 6ebdb2e to 1dddaf9 on 10 Oct. Migrations 98,
unchanged. bcf0689 (8 Oct: #135, #138, #140) was built but never released, so
it ships here.

| PR | Change |
|---|---|
| #140 | Records name only leads the caller may work: 14 routes check the lead a body names ([entry](2026-10-08-lead-attach-scope.md)). |
| #148 | Creating a plan in the console no longer reports "The server could not be reached." after creating it ([entry](2026-10-10-plan-form-reset.md)). |
| #135 | The rate-limit spec no longer fails when a window turns mid-case ([entry](2026-10-07-ratelimit-window-flake.md)); tests only. |
| #138 | Two more specs no longer fail that way ([entry](2026-10-08-limiter-window-specs.md)); tests only. |
| #147 | Android `com.youhan.one1` versionCode 10 ([entry](2026-10-10-android-one1-vc10.md)); the store bundle, not the server. |
| #142 | The release record of 6ebdb2e (docs). |

**Verified.** #140's E2E had never run on its PR (opened on #136's branch);
`main`'s CI on bcf0689 then passed in full. #148 was merged before its own CI
ran; `main`'s CI on 1dddaf9 passed in full (run 38049564768), its new E2E spec
included. Images built (run 38049638949). Staging 98 of 98, the staging-first
gate passed with production at 98, the restore drill verified, backup
20261010T122142Z shipped off the server, deploy OK, smoke 18 of 18, and
production reported BUILD_COMMIT 1dddaf9. Afterwards: health OK (database and
Redis up), `/login` 200, `/signup` 404 (sign-up closed), the plans API 401
without a session.

**Left open.**
- Self-serve sign-up stays closed until a trial length is set in the console;
  the owner's "Lead Eagle" plan (code 00004, created 10 Oct) is the active plan
  that includes Lead Eagle.
- The workspace sign-in error for one platform-owner account (a 500 from
  `/api/v1/auth/login`, 8 Oct) waits on the server log to find its cause.
