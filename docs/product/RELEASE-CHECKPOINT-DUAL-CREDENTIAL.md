# Release checkpoint — one platform identity, two passwords

Branch `feat/dual-credential-monitoring-login`, from the integration checkpoint
`05a7b90`. Not merged, not deployed, no production system touched, no production
identity provisioned. Every result below was produced on isolated, disposable
systems and names the SHA it ran against.

---

## 1. Candidate identity

| | |
| --- | --- |
| Candidate SHA | `03823b8d487cb916b831d3cc9053b477e7f58c96` |
| Base | `05a7b90` (docs) on `9df91d8` — the integration checkpoint |
| Commits | `1d174dc` security(auth) · `c35dee9` feat(platform) UI · `50d7f26` tests · `58d9524` fix(platform) owner code field · `03823b8` tests |
| Application change | 41 files, +2349 −434 (src, prisma, scripts); tests 6 files, +1636 |
| Migrations added | 1 — `20260914120000_dual_credential_sessions` (72 total) |
| Artifact | Next.js 16.3.4 standalone bundle, `BUILD_ID` **`lmzIBfetTC-GJ8GV1mhko`**, `server.js` sha256 `25f81cc8…c91bcf6`, built in the gate from `git archive` of the SHA, served with `node server.js` |
| Previous release, for rehearsals | `05a7b90`, built the same way, `BUILD_ID` `bEnxf07bxJuhYmnfql4AK` |
| Not built | A container image from `infra/Dockerfile` |

The baseline was chosen by reading the integration line, not assumed: `05a7b90` is
the latest integrated candidate with the monitoring console, the self-grant fix and
the break-glass entry fix. No older branch was used.

The designated identity was looked up in the local development database and is not
present there. Production was not inspected. Nothing in the code names that address.

---

## 2. What was built

### 2.1 The model

- `PlatformUser.passwordHash` is the **PLATFORM_ADMIN** credential for platform staff
  (OWNER, SUPPORT, SECURITY_AUDITOR). It confers what the *current* role confers and
  never more.
- `PlatformUser.monitoringPasswordHash` is an optional, independently salted
  Argon2id hash: the **MONITORING** credential. It always yields read-only monitoring
  of explicitly granted workspaces — regardless of role, membership, or a live
  WRITE / break-glass grant.
- Each credential has a version (`passwordVersion`, `monitoringPasswordVersion`).
  A session and an MFA challenge record the purpose and version they were issued for.
- Workspace users and machine identities have one credential and no purpose. Their
  sign-in is unchanged.

### 2.2 Sign-in (existing form, no mode selector)

1. `{email, password}` → equal work every time: two Argon2id verifications (an empty
   slot is verified against a dummy digest; refused accounts burn the same two).
2. The matching slot fixes the purpose. Both slots matching is a data defect: sign-in
   fails closed with the generic message and a `LOGIN_CREDENTIAL_AMBIGUOUS` event.
3. For staff, a **server-held challenge** (`PlatformMfaChallenge`: token hash,
   identity, purpose, credential version, 5-minute TTL, 5 attempts) is issued. The
   response carries an opaque token and nothing about the mode; the password field is
   cleared on the form.
4. `{challenge, mfaCode | recoveryCode}` → the identity is re-read; a changed role,
   revoked monitoring password, reset factor, disabled account or changed credential
   version ends the challenge. Only after MFA is a session created, carrying the
   challenge's purpose — never re-derived from the role. A → `/platform` (OWNER);
   B → `/monitoring`.
5. The body schema is strict: a client-supplied `mode`, role or anything else is a
   422. Both steps spend the same per-IP and per-account buckets.
6. A monitoring password never opens MFA enrolment: without an enrolled factor it
   signs in nowhere.

### 2.3 Enforcement on every request

`resolvePlatformCtx` re-checks status, session validity, the session's credential
purpose and version (`credentialRefusal`) on every request; a refusal revokes the
session. A staff session **without** a purpose (legacy) is refused, never read as
administration. For a MONITORING session:

| Surface | Enforcement |
| --- | --- |
| Owner console pages and APIs | `requirePlatformOwner` → 403 (pages redirect to `/no-platform-access`) |
| Workspace creation, grants, coverage, break-glass, user administration | owner-only → 403 |
| Workspace entry | READ grant or coverage only; `allowBreakGlass` is false, so a WRITE grant never admits it |
| Actor inside a workspace | never the membership actor; `buildSupportActor(… monitoringOnly)` → `platformMode: monitoring`, VIEW / VIEW_REPORTS on the monitoring allowlist, never full control |
| API kernel (`route()`), guarded routes (exports, streams) | non-GET/HEAD refused; self-service refused; EXPORT not in the permission set |
| SSR workspace pages | self-service screens refused; permission check as the API |
| Sensitive data (recordings, transcripts, documents) | only a **READ** grant with `sensitive = true`; a WRITE grant's sensitivity is ignored |
| HR / payroll | not on the allowlist |
| Membership switching, MFA enrolment, credential management | refused |
| Server actions | none exist; a static test fails if one is added |

Refusals on guarded routes and workspace pages are now audited (previously only
successes were — **this corrects the integration checkpoint's statement** that
refusals were recorded on every path). Every staff access row carries
`credentialPurpose`.

### 2.4 Credential lifecycle

- **Set / change / remove the monitoring password**: self-service at *Platform →
  Sign-in and passwords*, administration session only, re-authenticated with the
  administration password **and** a current TOTP code (throttled), policy-checked,
  distinct from the administration password. Sessions and challenges of the old
  credential end in the same transaction as the change.
- **Revoke another person's monitoring password**: a different owner, with their
  own TOTP code (*Users → person → Remove monitoring password*). Never self.
- **Change the administration password**: same re-authentication; every session in
  both modes ends.
- **Identical passwords refused** by every writer of either hash: self-service,
  workspace password change, reset link, owner reset, and `writePrimaryPassword`.
- **Reset links** carry a purpose. Staff links may only set PLATFORM_ADMIN; the
  monitoring password is never reset by email. Claimed atomically, single use.
- **MFA reset, disablement, deletion, demotion** end both modes and all challenges;
  demotion out of staff drops the monitoring password.
- **Closed pre-existing holes** found on the way: refresh dropped the session
  purpose and rotated enrolment-only sessions; a workspace admin could reset the
  password or remove the MFA of a platform staff member who was also a member;
  `bootstrap-owner.mjs` silently promoted an existing account to OWNER (now refuses
  without `--promote-existing`).

### 2.5 Audit

`LOGIN` / `LOGIN_FAILED` (with `credentialPurpose` and reason),
`LOGIN_CREDENTIAL_AMBIGUOUS`, `LOGIN_CREDENTIAL_INELIGIBLE`,
`MONITORING_CREDENTIAL_SET` / `CHANGED` / `REVOKED`,
`CREDENTIAL_REAUTHENTICATION_FAILED`, `PASSWORD_CHANGED` / `PASSWORD_RESET`
(with purpose), `SUPPORT_READ` (mode, purpose, status incl. refusals). No password,
hash, reset token, TOTP secret or record content is written; tests assert this.

---

## 3. Gate results on `03823b8`

Environment, as the integration checkpoint: `mcr.microsoft.com/playwright:v1.62.0-noble`
(Ubuntu 24.04, Node 24), `--shm-size=2g`, one network namespace with fresh
disposable containers `dualgate-0914-*`: Postgres 16 (database `dualgate_val`, 0
tables before migration), Redis 7 with a password, Mailpit requiring STARTTLS,
ClamAV, MinIO. A local CA signs the TLS terminator and the SMTP leaf; verification
is never disabled.

### 3.1 Passed

| Gate | Result |
| --- | --- |
| `npm ci`, `generate-secrets` (as CI) | ok |
| `prisma migrate deploy` on an empty database | 72 applied |
| Drift (`migrate diff --exit-code`) | no difference |
| `check-rls` | 184 tenant tables RLS forced and policied, 7 exempt |
| `check-raw-sql-scope`, seed | ok |
| `tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 132 warnings (131 at the base) |
| `format:check`, `schema-stats --check` (README updated) | ok |
| Observability, Redis auth, face token gate, backup round trip | ok |
| `npx vitest run` | **167 files, 2264 passed, 0 skipped, 0 failed** |
| `npm run test:server` (E2E_* named) | ok |
| `next build`, bundle without `.env*` | ok |
| Production guards | all six refused (mock email, mock antivirus, proxy `none`, owner role as app role, demo DB under staging, no `APP_ENV`) |
| Accepted configuration | `/api/health/live` 200 over HTTPS, `ssl_verify_result=0`; `/login` 200; dev outbox 404 |
| SMTP | reset mail delivered over STARTTLS with verification; without the CA nothing was sent (Mailpit 1 → 1, "unable to verify the first certificate") |
| **Browser suite** against the artifact, `E2E_PROFILE=local-capture`, browser trusting only the local CA | **52 passed** (4.1 min) — 47 existing + 5 new |
| **Upgrade and rollback rehearsal** (§5) | **51 / 51** |

Local Windows run of the same suites before the gate: 167 files, 2260 passed,
2 skipped (the POSIX file-mode checks, which run on Linux).

### 3.2 Test coverage of the requirement (through real login and MFA)

`tests/security/dual-credential-auth.spec.ts` (37 cases) drives the login route and
uses the exact cookie it issued; `tests/unit/credential-match.spec.ts` (7);
`tests/e2e/dual-credential-login.spec.ts` (5, browser, the real form).

| Required case | Where | Result |
| --- | --- | --- |
| A → administration; B → read-only monitoring | security spec, e2e, rehearsal | pass |
| Password alone issues no session; response does not name the slot | security spec | pass |
| Wrong password = unknown email (same body); wrong MFA for either password | security spec, e2e | pass |
| Client-supplied `mode` refused (422) | security spec | pass |
| Enrolment-only session reaches no console, monitoring, credential API or refresh | security spec | pass |
| Monitoring password without enrolled MFA signs in nowhere | security spec | pass |
| Identical passwords refused: console, workspace self-change, reset link, UI | security spec, e2e, rehearsal | pass |
| Both slots matching → refused + `LOGIN_CREDENTIAL_AMBIGUOUS` | security spec | pass |
| OWNER + workspace admin + WRITE grants, in monitoring: WRITE does not admit; READ admits; no membership actor; writes, HR, transcript, self-service, export refused | security spec, rehearsal | pass (export with positive control: same role exports 200 as a member) |
| Direct admin URLs (`/platform`, `/platform/security`, `/platform/users`) | e2e | redirect to `/no-platform-access` |
| Admin APIs: grants issue/revoke, workspace creation, break-glass, user actions, credential API, MFA enrolment, membership switch | security spec, e2e, rehearsal | all 403 |
| Server actions | unit spec (static) | none exist |
| Grant revocation and expiry mid-session | security spec | next request 403 |
| Sensitive READ grant opens the transcript, removal closes it | security spec | pass |
| Audit failure → no data served | security spec | pass |
| Audit rows carry mode and purpose, including refusals | security spec | pass |
| Combined rate limit across both passwords (5 per account) | security spec | 6th attempt 429, even with the right password |
| Change B: its sessions and pending challenges end, even a row whose revocation was lost; A sessions untouched | security spec | pass |
| Revoke B by another owner: monitoring ends, A hash and version unchanged | security spec | pass |
| Emailed A reset: single use, both modes signed out, B still works, no secret in audit | security spec | pass |
| Reset link for MONITORING or no purpose refused for staff | security spec | pass |
| MFA reset and disablement end both modes and pending challenges | security spec | pass |
| Separate sessions and tabs keep their mode; refresh keeps MONITORING | security spec, e2e, rehearsal | pass |
| Customer sign-in unchanged (no purpose, workspace destination) | security spec, rehearsal | pass |
| Legacy staff session refused and revoked; customer legacy session accepted | security spec, rehearsal | pass |
| Equal work: exactly two verifications for every outcome and for refusals | unit spec | pass |
| Existing suites for AI_SERVICE login, service identities, workspace auth | full vitest | unchanged, pass |

The suite has teeth: disabling the credential version check, the monitoring
read-only guard and the monitoring-only actor flag made 11 of its cases fail.

### 3.3 Failed — harness faults, corrected and re-run (not application results)

| Run | Fault | Correction |
| --- | --- | --- |
| Upgrade phase, first run | 4 checks compared `revokedAt IS NOT NULL` concatenated as text with `t`/`f`; Postgres renders `true`/`false`. Values recorded were the expected ones (`CREDENTIAL_PURPOSE_MIGRATION|true`, `|false`). | Compare with `true`/`false`. |
| Rollback phase, first run | After a 429 the driver re-sent the same body after 120 s, with a TOTP code from an expired window — the previous release correctly answered 401, and roll-forward then ran without its precondition (one check passed vacuously on a null cookie, the next crashed). | The body is rebuilt per attempt with a fresh code; missing preconditions now fail loudly. |

Both phases were re-run in full (§5) on a new rehearsal database from a snapshot of
the finished runner — the same two builds. The first run's results are kept
(`dual-rehearsal-results.first-run.json`). The rate limiter was never cleared; the
driver waits out `Retry-After`.

### 3.4 Application defects found during this package, fixed

- `58d9524`: the owner code field in user management used `/D/g` instead of `/\D/g`.
  Found in review before the gate; the gate ran on the fixed SHA.

### 3.5 Not executed

- A container image from `infra/Dockerfile`.
- Anything against staging or production, including looking up the designated
  identity there.

---

## 4. Migration

`20260914120000_dual_credential_sessions` — details and lock notes in the runbook
§3.1a. On the rehearsal database it applied in 2 s with no drift afterwards.

- Adds the enum, the version and monitoring columns, the session and reset-link
  purpose columns, and `PlatformMfaChallenge` with its application-role grant.
- Revokes live sessions of OWNER / SUPPORT / SECURITY_AUDITOR except AI_SERVICE
  sessions (`CREDENTIAL_PURPOSE_MIGRATION`); retires their unused reset links.
- Creates no credentials, grants or coverage.

---

## 5. Upgrade and rollback rehearsal — 51 / 51

Previous release `05a7b90` and candidate `03823b8`, both as built artifacts, on a
dedicated database migrated and seeded **by the previous release**, with synthetic
identities (owner with READ and WRITE grants, support with a READ grant, a customer
member, an AI_SERVICE identity with a live session, reset links for owner and
customer). All passwords and the TOTP secret were random per run, held in a
container-local file deleted at the end.

| Phase | Checks | Outcome |
| --- | --- | --- |
| Previous release: sign-ins | 5 | owner, support and customer sign in; owner API and customer workspaces answer |
| Candidate migration | — | applied; no drift |
| After upgrade | 17 | owner and support sessions revoked by the migration; customer and AI_SERVICE sessions untouched; 0 monitoring credentials; grant and coverage counts unchanged; staff reset link retired, customer's kept; no session carries a purpose; old staff cookies 401, old customer cookie 200; password A: challenge without session, then `PLATFORM_ADMIN` session to `/platform` |
| Provisioning B through the API | 15 | B = A refused 409; B set after re-authentication; B: challenge, then `MONITORING` session to `/monitoring`; owner API, workspace creation, break-glass 403; WRITE-only workspace 404; READ workspace 200; workspace write 403; refresh keeps `MONITORING`; admin session unaffected |
| **Image swap to the previous release** | 2 | **UNSAFE, demonstrated:** the live monitoring session gets **200 on the owner API and sees the ungranted workspace**. Password B does not sign in there (401). |
| Remediation (web stopped) | 2 | 1 monitoring session revoked; none live remain |
| Previous release after remediation | 2 | monitoring session 401; owner signs in with A |
| Roll-forward to the candidate | 6 | the session issued by the previous release 401 and revoked as `LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE`; revoked monitoring session stays refused; B still yields monitoring and A administration (credentials kept); no ambiguity events |
| Cleanup | 1 | credential state file removed |

**Rollback conclusion** (runbook §9.1.4): no earlier release is a safe target by
image swap. Rolling back is only acceptable inside the emergency procedure (§9.1.1),
with every monitoring session revoked while the web tier is stopped; keep the
monitoring hashes for roll-forward; roll-forward needs no session data step.

---

## 6. Provisioning the designated identity

Not done, by design. Procedure in runbook §3.2: find the existing identity (never
create or promote one), the person sets their own monitoring password from an
administration session with MFA, a second owner issues READ grants, verify, and
revoke without touching the administration password. No password is requested,
generated, stored in configuration or placed in a fixture.

---

## 7. Remaining blockers and open points

1. **Rollback is not an image swap** (§5). The release owner must accept that
   rolling back requires §9.1.1 plus revocation of monitoring sessions, and that the
   migration signs out all platform staff.
2. **TOTP reuse within one window.** A code that just signed a person in is still
   accepted, within its 30-second window, to re-authenticate a credential change.
   The rate limit (10 per 5 minutes) bounds it; it does not close it. This is the
   existing `verifyTotp` behaviour, unchanged here. Decide whether to record the last
   accepted time step.
3. **No grant-management screen.** A second owner issues monitoring grants through
   the API; the owner-facing UI is the deferred package.
4. **Independent security review** of this change is outstanding. Evidence is
   provided; sign-off is not claimed.
5. **No container image** has been built for this SHA.
6. **Carried from the integration checkpoint, unchanged:** break-glass cannot create
   records (500); CI's server integration step needs `E2E_*`; the monitoring scope
   decision on aggregate call metrics and coaching notes; unrehearsed reboot and
   staging operations.
7. **Production provisioning** of the designated email remains a separate, authorised
   step after review.

---

## 8. Recommendation

For the tested scope — dual-credential sign-in on the integration candidate, as the
standalone artifact at `03823b8`: **ready for security review and staging.** Not for
production until blockers 1, 2 and 4 are decided and the image is built.

---

## 9. Development cleanup — isolated systems only

- Containers `dualgate-0914-{pod,pg,redis,mailpit,minio,clamav,runner,rehearse}`,
  volume `dualgate-0914-gate`, image `dualgate-snap:1`.
- Host Postgres database `dualcred_20260914_test` (local test database for this
  package). `apps/web/.env.test` points back at `master_saas_test`.
- The earlier `intgate-09121648-*` containers and images from the integration
  checkpoint are still present.
