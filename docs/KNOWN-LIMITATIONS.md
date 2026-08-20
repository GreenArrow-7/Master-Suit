# Known limitations and residual risk

The requested unified SaaS acceptance flow is implemented and tested, but the
following items still prevent an unconditional commercial-production claim:

- **Row-level security is enforced, and the application connects as the role it
  applies to.** `20260803230000_rls_full_coverage` enables RLS on every table
  carrying `tenantId`, `20260806000000_rls_force_and_platform_admin` adds FORCE
  so table ownership is not a quiet bypass, and `master_saas_app` is a `LOGIN`,
  `NOBYPASSRLS`, non-superuser role. `DATABASE_URL` names that role in `.env`,
  `.env.test` and `.env.example`; `MIGRATION_DATABASE_URL` keeps the owner, and
  `src/lib/startup-check.ts` refuses to boot in production if the two are the
  same, if the role can bypass RLS, or if it owns an unforced table.
  `tests/tenant/rls.spec.ts` proves the policies over raw pg; the 639-test suite
  and the server integration suite both run against the application role, so the
  application code *is* in the loop.
  The `{ tenantId: { in: [...] } }` gap recorded here previously is gone — no such
  filter remains in `src/`.
  `20260808200000_rls_call_intelligence` closes the last real hole: RecordingConsent,
  Recording, Transcript, AIAnalysis and CallAudit were on the bootstrap exclusion
  list and did not belong there. A bootstrap exclusion is for a lookup that
  *cannot* name a tenant — a session token, a reset link, a webhook key. Those
  five were excluded only because the code reached them by `callId`, which is
  unique, so `findUnique({ where: { callId } })` compiled; every one of those
  callers already knew the tenant. The effect was that transcripts, AI summaries
  of what a client said, and the audio itself were the least protected rows in
  the database. Call sites now pass `tenantId` alongside `callId`, the exemptions
  are gone from `src/lib/db.ts`, and the coverage assertion in `rls.spec.ts` will
  fail if any of them reappears.
  What remains: `IntegrationConnection`, `APIKey`, `PasswordResetToken`,
  `RateLimitCounter`, `WorkspaceInvitation`, `WorkspaceMembership` and
  `PlatformAuditEvent` are still outside RLS. Each is a genuine bootstrap or
  control-plane case — a telephony vendor posting to a URL knows nothing about
  workspaces — and each is guarded by a hashed bearer secret and tenant-scoped
  administrative reads instead.
- **Field-level security is tested again.** `tests/permission/field.spec.ts` had
  been deleted rather than fixed — it asserted against `/api/v1/leads/export` and
  `/api/v1/reports/run`, neither of which exists — which left `loadFieldRules`,
  `applyFieldSecurity`, `stripUneditableFields` and `assertFilterableFields`
  entirely uncovered. `tests/permission/field-security.spec.ts` replaces it,
  written against `/api/v1/opportunities`, which is where field security is
  actually wired: hiding, masking, the strip-on-write path, per-role and
  per-object rule scoping, every masking strategy, and the refusal to filter or
  sort on a hidden field. That last one is the case that matters — masking is
  worthless if a caller can recover the value by bisecting a filter over it.
- **Filtering works on leads and nowhere else.** `FIELD_MAP` in
  `src/lib/api/filterTree.ts` registers an allow-list for `LEAD` only; the
  comment beneath it says "OPPORTUNITY, ACCOUNT, TASK, TICKET, ACTIVITY maps
  follow the same shape", and none of them were written. Every list route still
  accepts a `filter` parameter, validates it, and checks it against field
  security — and then rejects it with `400 unknown-object` for every caller.
  Found by the positive control in the field-security suite, which asserts the
  400 explicitly so the test fails the day a map is added.
- **The Python HRMS has been archived out of the repository.** It ran nothing and
  was referenced by nothing; HRMS runs natively in the Next.js app against
  PostgreSQL. All 139 files, including the SQLite database, now live in
  `../archive/master-saas-apps-hrms/`. See `docs/adr/0001-archive-python-hrms.md`.
- **The legacy Sales-only shell under `src/app/(app)` has been removed.** Every
  screen it held now lives under the canonical boundary: the CRM screens at
  `/{workspaceSlug}/sales/...` (with the old `home` dashboard as
  `/{workspaceSlug}/sales`), and the richer administration, settings, audit-log
  and integration screens as static segments under `/{workspaceSlug}/admin/...`,
  where they shadow the corresponding cases of `admin/[section]`. Links inside
  those pages are module-relative and resolved by
  `src/components/workspace/SalesLink.tsx`.
  What remains: the unscoped compatibility URLs (`/leads`, `/calls`, …) no longer
  resolve at all. Downstream bookmarks and integrations pointing at them need to
  be repointed at the workspace-scoped paths; no redirect shim was added.
- **HRMS leave and employee lifecycle are now real workflows** (matrix rows
  H18–H22, H24, H25): accrual and balances, holiday-aware day counting, overlap
  refusal, an approval queue that re-checks balance at decision time and refuses
  self-approval, onboarding/offboarding checklists with a RERA agent track,
  UAE gratuity and final settlement, and a clearance-gated exit that revokes
  sessions and withdraws biometric consent.
- **Face check-in runs against a Python sidecar (`apps/face`)** — matrix rows
  H08–H15 and H27. The sidecar is stateless: detection, embedding and pose only,
  no database, no tenant awareness, no product logic. Every policy decision
  (challenge direction, pose thresholds, match threshold, enrolment spread) lives
  in `src/services/hr/face.ts` so it is testable in one suite. Capture frames are
  encrypted at rest with AES-256-GCM and purged by the retention job.
  What remains: **a real face has not been verified end to end.** The pipeline is
  proven — engine health, the sidecar's refusal path over the wire, consent
  gating, enrolment gating, geofence, GPS-accuracy ceiling, sequence rules,
  offline deduplication, stale-sync refusal, day roll-up, capture encryption and
  consent-withdrawal deletion all pass against the live database and the real
  ONNX models — but detection→embedding→match on an actual human face needs a
  camera and a person, and no automated check can stand in for that. Run a
  supervised enrolment and check-in with real staff before going live, and tune
  `FACE_MATCH_THRESHOLD` (0.55 is a starting point) against your own people,
  lighting and phones.
  Also not done: liveness is not certified presentation-attack detection. It
  stops a held-up photo, a static screen and a face swapped between frames. It
  will not reliably stop a good video replay on a good screen and has not been
  tested against 3D masks. If you need a guarantee, buy an iBeta Level 1/2 SDK
  and put it behind the same interface — nothing else in the pipeline changes.
  There is no browser-side offline queue yet either; the server accepts and
  deduplicates replayed punches, but the client does not queue them.
- **Every HR parameter is now workspace-editable at `/{slug}/people/settings`.**
  The thresholds ported from the original were hardcoded constants, which is
  wrong for a multi-workspace product: a face threshold that suits one company's
  staff, lighting and phones does not suit another's, and a firm on a
  Friday-Saturday weekend cannot use a Saturday-Sunday default. All 30
  parameters — face matching, liveness, geofence, accrual, gratuity, notice,
  RERA departments — come from one registry in `src/services/hr/settings.ts`
  that supplies the default, the validation rule and the admin form field, so
  they cannot drift apart. Only overridden keys are persisted, so a default
  changed in a release still reaches workspaces that never touched it, and every
  change is audited with its before and after value.
  Settlement snapshots record the **full resolved policy** alongside the inputs,
  not just a version string, so a payout stays re-derivable after someone edits
  the rates — a settlement calculated at 25 days/year still reads 25 after the
  live rate drops to 21. Attendance captures are sharded by tenant, so the
  retention job applies **each workspace's own** `captureRetentionDays` to its
  own subtree rather than one global window; that sharding is also what makes a
  PDPL deletion request actionable against a single workspace.
- **All 28 HRMS rows are now migrated** (H01–H28). What that does *not* mean:
  - **A real face has still never gone through the pipeline end to end.** See the
    face check-in entry above. This is the single largest gap between "migrated"
    and "ready for staff".
  - **No virus scanner is configured.** `ANTIVIRUS_PROVIDER` is `mock`, so
    document uploads are stored unscanned and record `virusScan: skipped` rather
    than pretending to be clean. Wire a real scanner before accepting uploads
    from people outside the company.
  - **Payroll and WPS export now exist** (`20260808160000_hr_payroll`):
    effective-dated compensation, maker-checker runs, payslips, and a SIF
    export. Three caveats before it touches a real bank. The **SIF layout is one
    documented variant** — banks differ on date format and column order, so
    `SIF_LAYOUTS` in `src/services/hr/wps.ts` is keyed and the record builders
    are pure; validate the output against the receiving bank's specification
    before the first live run, because a rejected file is a payroll that did not
    happen. The **`payroll` permissions are granted to nobody by default** and
    are deliberately not backfilled, so the screens are invisible until an
    administrator grants them. And **no payslip PDF is generated** — the payslip
    renders as a page, which is enough to read and print but is not a document
    that can be emailed or archived.
  - **Recruitment now exists** (`20260808180000_hr_recruitment`): requisitions
    with approval, candidates and a pipeline, interviews with panel-restricted
    scorecards, versioned offers, and a hire that issues an invitation and links
    the resulting employee back to the application. Caveats: like `payroll`, the
    `recruitment` permissions are **granted to nobody by default**, so the
    screens stay invisible until an administrator grants them; **no careers page
    or job-board integration exists**, so candidates are entered by a recruiter
    rather than applying themselves; **no offer-letter document is generated**,
    only the terms are recorded; and **starting the onboarding checklist after a
    hire is one manual click**, because the employee record does not exist until
    the invitation is accepted and acceptance has no HR actor to attribute a
    checklist to.
  - **Performance management now exists** (`20260808190000_hr_performance`):
    review cycles, weighted goals, a self → manager → calibration →
    acknowledgement sequence that cannot be skipped, a configurable competency
    framework, and improvement plans with checkpoints. Caveats: the
    `performance` permissions are **granted to nobody by default**; **there are
    no reminders** — an overdue self-assessment is visible on the page but
    nothing chases it, because performance events are not yet wired into the
    notification service; and **360°/peer review is not implemented**, only
    self, manager and HR calibration.
  - **Reporting now exists** (`src/services/hr/reports.ts`): 17 reports across
    people, attendance, leave, lifecycle, payroll, recruitment and performance,
    behind one registry. Each report declares the permission for the *data* it
    returns rather than a generic reporting one, and the list, the run and the
    CSV export all resolve through a single gate — so an export cannot reach a
    report the screen would have hidden. `tests/hr/reports.spec.ts` asserts that
    parity across the whole registry for two different roles, so a future report
    that guards `run` but not the export fails without anyone adding a case.
    Caveats: **CSV only** — there is no .xlsx writer and no PDF renderer, though
    the UTF-8 BOM means Excel opens the CSV correctly rather than mangling
    Arabic names; and the reports read at workspace scope, so a manager holding
    a permission at TEAM scope still sees the workspace-wide figure for it.
  - **The approval queues now notify.** 18 HR events are emitted at their
    decision points — leave, overtime, shift changes, payroll, requisitions,
    interviews, offers, reviews and improvement plans — writing an in-app
    notification synchronously and queueing the email on a new `notifications`
    queue with a worker behind it. Recipients are resolved through
    `RolePermission` rather than by role name, so "whoever can approve overtime"
    stays correct in a workspace that invented its own roles, and the actor is
    never notified of their own action. A notification failure is swallowed and
    logged: the decision is the durable thing, and an approval must not roll
    back because Redis was down. What remains: **no digest and no reminder** —
    an event fires once, so an approval ignored for a week is never chased
    again; and **notification preferences are not implemented**, so a user
    cannot opt out of anything.
  - Session rotation exists at `/api/v1/auth/refresh` but **no client calls it
    automatically**; nothing in the UI refreshes on a timer yet, so in practice
    tokens live until they expire.
  - H28 covers the shell being usable on a phone. It has been verified by reading
    the CSS and the components, **not on a real handset** — no device testing has
    been done.
- **Two face photographs were removed from source control, history included.**
  `apps/hrms/tests/faces/lena.jpg` and `messi.jpg` were photographs of
  identifiable people committed as test fixtures. They are gone from the index,
  the tests now read fixtures from a git-ignored local path, and a verified
  `git filter-repo` run removed them from history — every commit hash changed as
  a result. `docs/TEST-DATA-POLICY.md` records the rule and
  `npm run check:test-data` enforces the mechanical part.
  **Two follow-ups remain:** the pre-rewrite mirror backup at
  `../master-saas-history-backup-20260805-212249.git` still contains both images
  and should be deleted once the rewrite is accepted; and if `GreenArrow-7` holds
  a separate clone, it is now incompatible and still contains them.
- **`schema.prisma` had drifted ahead of the migrations and this is a recurring
  risk.** `HrLeaveBalance`, `HrChecklistTask`, `HrOffboardingCase`,
  `HrSettlementSnapshot` and `HrEmployeeLocationAssignment` were declared in the
  schema but no migration ever created them, so any code touching them failed at
  runtime while typechecking cleanly. `20260805000000_hr_lifecycle_and_schema_drift`
  closes the gap and re-runs the catalog-driven RLS block for the new tables.
  **Now enforced.** CI gate 0a runs
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
  --exit-code` against the database it has just replayed every migration into, so
  the schema and the migration history are compared directly. `npm run check:drift`
  runs the same check locally.
- **Copying the catalog-driven RLS sweep into a new migration is a live trap, and
  it has now fired once.** Several HR migrations end by re-running the sweep from
  `20260803230000_rls_full_coverage`, each carrying its own inline copy of the
  `bootstrap` exclusion array and of the policy body. Both have moved since:
  `20260806000000` added `FORCE ROW LEVEL SECURITY` and the
  `app.platform_admin` branch, and `20260807020000` moved `WorkspaceInvitation`
  into the bootstrap set. A migration that pastes an older copy therefore
  silently *downgrades* security across every tenant table — dropping FORCE, so
  the owner role bypasses RLS again — and enables RLS on `WorkspaceInvitation`,
  which breaks every invitation link because the token lookup runs before any
  tenant is known. The first draft of `20260808140000_hr_overtime` did exactly
  this; it was caught by `tests/tenant/rls.spec.ts` and
  `tests/integration/invitation-flow.spec.ts` failing together, and the shipped
  version instead named the single table it creates.

  **And the replacement was wrong too, in a different way, and went unnoticed
  from 2026-08-08 until 2026-08-20.** The snippet this document used to print as
  the fix is itself the defect:

  ```sql
  -- What shipped. Correct-looking, and missing both of the things
  -- 20260806000000 had added six migrations earlier.
  ALTER TABLE "HrOvertimeRequest" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "HrOvertimeRequest" FOR ALL TO master_saas_app
    USING ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));
  ```

  No `FORCE`, so the owning role bypassed the policy; and no
  `app.platform_admin` branch, so `withPlatformTx` — the control plane, and the
  retention sweep — matched nothing on that table at all. Neither test suite
  could see it, because both check tenant-to-tenant isolation and this broke
  neither. `20260820100000_hr_overtime_rls_parity` fixes it.

  **A migration that adds tables should write a policy for those tables only** —
  and CI gate 0b (`npm run check:rls`) now asserts the result against the
  Postgres catalog: every `tenantId` table enabled, FORCED, policied, with both
  clauses testing `app.tenant_id` and carrying the `app.platform_admin` branch,
  and no policy scoped `TO` a single role. It found `HrOvertimeRequest` on its
  first run.

  Two of the three hand-kept lists remain hand-kept — `GLOBAL_UNIQUE_FIELDS` in
  `src/lib/db.ts` and the expected list in `tests/tenant/rls.spec.ts`. The third,
  the `bootstrap` array, is now cross-checked against the catalog by the gate.
- **AI spend is metered per workspace and capped on the shared key.** Nothing
  counted tokens before — not per tenant, not in aggregate — so one workspace
  transcribing a backlog could exhaust the deployment's Gemini budget for
  everyone, with no record afterwards of which one had. All four surfaces
  (analysis, audit, live coach, assistant) now record `usageMetadata` into
  `WorkspaceUsage` under a month-keyed metric, and `assertAiBudget` refuses
  further work past the plan's `ai_tokens_monthly` limit. Two deliberate
  asymmetries: a workspace on its **own** Gemini key is metered but never capped
  — its quota, its bill — and the live coach degrades to heuristic hints rather
  than throwing, because interrupting somebody mid-call with a billing error is
  not a trade worth making. What remains: the ceiling is approximate, since usage
  is recorded after each response and a burst of concurrent jobs can carry a
  workspace some way past it before the first records anything; and no plan ships
  with `ai_tokens_monthly` set, so the cap is inert until an operator chooses a
  number.
- Plan creation, assignment, module switching, limits, suspension and archive are
  implemented. External payment collection, invoices, tax and billing-webhook
  settlement are not connected to a real billing provider.
- **The password policy's `reuseWindow` and `maxAgeDays` are now enforced.** Both
  were typed on `PasswordPolicy` from the start and `reuseWindow` was offered on
  the workspace settings screen with a 0..24 validator; nothing read either, so
  an administrator who turned them on got a setting that saved, redisplayed, and
  did nothing. `20260820110000_password_history` adds the table there was nothing
  to compare against, `services/identity/passwordHistory.ts` enforces both, and
  `maxAgeDays` is settable for the first time. Expiry and the existing
  temporary-password gate now flow through one predicate rather than two
  lookalike checks. What remains: reuse is enforced on user-chosen passwords —
  self-service change and forgot-password redemption — and recorded but not
  enforced on an administrator's reset, because refusing a recovery path on a
  history collision turns it into a lockout.
- Platform-owner MFA data is modeled, but enrollment, recovery and a mandatory
  production MFA policy are not complete.
- Production providers, object-store retention, backup restoration, incident
  response and a full legacy data migration rehearsal still require deployment-
  specific configuration and operational testing.

- **The engagement features need live provider credentials to do anything.** Google
  Meet provisioning, WhatsApp event circulation and WhatsApp campaign sends all
  read an `IntegrationConnection` row with `status = 'CONNECTED'` and refuse to
  run without one. They deliberately do **not** fall back to the mock providers,
  because a mock returns a plausible meeting link and message id that would read
  as success while nothing was sent.
  Those rows now have a UI: `/{slug}/admin/integrations` connects, verifies,
  re-tests and disconnects every provider, and shows the callback URL to paste
  into the vendor's console. Credentials are wrapped with AES-256-GCM under a
  key derived from `FIELD_ENCRYPTION_KEY` before they reach the database and are
  never returned by any route — see `src/lib/security/envelope.ts`.
- **Outbound dialling now has four vendor implementations, none of which has
  placed a real call.** `src/lib/integrations/telephony/` carries Twilio, Exotel,
  Knowlarity and Plivo behind one interface, each with its own signature scheme
  (`X-Twilio-Signature` over URL + sorted params; `X-Plivo-Signature-V3` over URL
  + nonce; a derived URL token for the two that sign nothing), and
  `resolveTelephony` picks the workspace's chosen vendor from
  `OrganizationSetting.telephonyProvider`.
  What remains: **every adapter is written against the vendors' documented APIs,
  and no live account has yet placed a call.** What *is* proven, and is as close
  as a test suite can get: `tests/security/telephony-vendors.spec.ts` covers the
  four signature schemes and the status normalisation, and
  `tests/integration/telephony-webhook-flow.spec.ts` drives the whole lifecycle
  through the real webhook route with signed, vendor-shaped bodies — ringing,
  answer, completion, a redelivery, an out-of-order callback that must not reopen
  a finished call, a recording discarded for want of consent and one stored with
  it, plus refusals for an unsigned delivery, an unknown connection key and an
  Exotel callback missing its URL token. What that cannot prove is the *outbound*
  half: that the vendor accepts our create-call request. Save-and-verify makes a
  live authenticated read at connect time for Twilio, Plivo and Exotel, which
  catches a wrong key; the rest needs a handset.
  `docs/TELEPHONY-PROVIDERS.md` has the per-vendor console setup and a
  step-by-step first-call procedure — run it with a colleague, not a client.
  Capability gaps are declared rather than papered over: Plivo
  exposes no CallUUID at create time so hang-up and status polling are absent
  from its capability list, and Knowlarity has no read-only endpoint so its
  connection cannot be verified at save time and reports as unverified.
  Exotel and Knowlarity **do not sign callbacks at all**. Their endpoint is
  authenticated by the unguessable `webhookKey` in the path plus a derived
  `token` query parameter compared in constant time. That proves the caller knows
  a secret; it does not prove the body is untampered. Restrict those endpoints to
  the vendor's source addresses at the edge where the deployment allows it.
- **Call recordings are fetched into our own object storage, and only then are
  they readable.** The webhook stores the vendor URL under
  `Recording.storageBucket = 'provider'` and enqueues `media/recording.ingest`;
  the worker downloads the media, writes it to `recordings/{tenantId}/{callId}`
  and clears the marker. `GET /api/v1/calls/[id]/recording` no longer returns
  `storageKey` at all, and `/recording/media` streams the bytes through an
  authorised handler that re-checks consent on every read.
  What remains: **the ingest worker must be running.** `npm run worker` now
  starts it; without it recordings stay on the vendor's servers, the download
  route refuses them and transcription has nothing to read.
- **AI call analysis never completed a single run before this release.**
  `POST /api/v1/calls/[id]/analysis` ended in
  `prisma.aIAnalysis.update({ where: { callId } })` against a row that nothing
  created, so every first analysis raised P2025 *after* the model had been
  called and paid for — and because `POST /calls/[id]/audit` requires a
  `COMPLETED` analysis, the whole audit, scoring and coaching chain was
  unreachable. The row is now claimed atomically before the model is called,
  which is also the concurrency guard the previous read-then-act check was not.
  Transcription, analysis and audit now run on the `ai` queue rather than inside
  the request: recording ingested → transcribe → analyse → audit, each step
  idempotent, each claiming its row before any billed work, with BullMQ backoff
  and the vendor's own message recorded on the row when it finally gives up. The
  routes claim and enqueue, so a second press is a 409 rather than a second
  billed model call, and the caller polls `GET`.
  What remains: **the `ai` worker must be running** (`npm run worker`), or every
  summary and audit stays `PENDING` forever. And a re-analysis overwrites a
  human's corrections — `humanCorrected` is recorded but not honoured by the
  worker, which is why re-analysis is an explicit action and not automatic.
- **Invitees can now RSVP for themselves** at `/rsvp/{token}`, a public page
  outside every route group with no session and no workspace shell. The token is
  `{tenantId}.{inviteeId}.{HMAC}` derived under `WEBHOOK_SIGNING_PEPPER` — no
  column, revocable for everyone at once by rotating the pepper, and carrying the
  tenant so the unauthenticated lookup is scoped exactly like an authenticated
  one rather than needing an exception in the tenant guard and in RLS. A bad
  token is a 404, never a 403, so a valid token cannot be used to enumerate an
  event's guest list. The Meet link is withheld until the invitee confirms,
  because an invitation carrying the joining link *is* the joining link and
  invitations get forwarded. `viewedAt` is its own column rather than an
  `RsvpStatus` value, since viewing and answering are orthogonal.
  What remains: **the WhatsApp template must carry a dynamic-URL button** for the
  link to reach anyone. Send with `rsvpButton: true` against a template whose
  button base URL is `{APP_URL}/rsvp/`; the token goes in as the suffix. Sending
  that parameter to a template without a button is a 132000 from Meta for every
  recipient, which is why it is off by default. No email invitation carries the
  link yet either — WhatsApp only.
- **"Square Beats" is not implemented.** No feature list, screenshots or access to
  the Square Yards application were available, so nothing was built for it. The
  product owner has said they will supply the module list, workflows and screens;
  until they arrive there is nothing to map Reuse/Enhance/Replace/Integrate/
  Deprecate against, and guessing would create exactly the duplicate modules the
  requirement exists to prevent.
- **The legacy `Integration` table is now unreferenced.** It was a catalogue model
  that nothing ever wrote a row to, read by one page that has been replaced with
  the `IntegrationConnection` board. Dropping it is a one-line migration nobody
  has run, because dropping a table is not reversible by a rollback of code.

These are explicit release gates, not hidden behind placeholder success states.
