# Known limitations and residual risk

The requested unified SaaS acceptance flow is implemented and tested, but the
following items still prevent an unconditional commercial-production claim:

- **RLS coverage is now complete, but the runtime still connects as the owner.**
  `20260803230000_rls_full_coverage` enables RLS on every table carrying
  `tenantId` (103 tables) except a documented bootstrap set, and makes
  `master_saas_app` a `LOGIN`, `NOBYPASSRLS`, non-superuser role.
  `tests/tenant/rls.spec.ts` connects *as that role over raw pg* and proves
  fails-closed reads, cross-workspace read/update/delete refusal and `WITH CHECK`
  insert refusal — the application code is not in the loop for that proof.
  What remains: the default `DATABASE_URL` still names the owner role. Flipping
  it to `master_saas_app` needs every query path to carry tenant context. The
  Prisma extension now sets `app.tenant_id` per query for any operation with a
  literal `tenantId`, and `withTx`/`withTenantTx` cover transactions, but queries
  filtering `{ tenantId: { in: [...] } }` and the bootstrap bearer-secret lookups
  do not — so the flip would break them today. This is the single largest
  remaining gap between "RLS is enforced" and "RLS is enforced for the app".
- **`tests/permission/field.spec.ts` was deleted, not fixed.** It asserted
  against `/api/v1/leads/export` and `/api/v1/reports/run`, neither of which
  exists, using fabricated fixtures. Field-level permission behaviour
  (`loadFieldRules`/`applyFieldSecurity`) is therefore currently untested.
- **The Python HRMS service in `apps/hrms` is vestigial.** `start.ps1` no longer
  launches it; HRMS runs natively in the Next.js app against PostgreSQL. Its
  SQLite file (`master_saas_hrms.db`, 137 rows, all reference/seed data — no
  customer records) and pytest caches are still on disk, and its test suite
  cannot run without a Python environment. It should be removed deliberately
  rather than left ambiguous.
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
  - **Payroll and WPS export do not exist**, and never did in the original
    either — they are new product work, not a migration gap.
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
  Nothing enforces that the schema and the migrations agree — a CI step running
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
  --exit-code` would catch the next one.
- Plan creation, assignment, module switching, limits, suspension and archive are
  implemented. External payment collection, invoices, tax and billing-webhook
  settlement are not connected to a real billing provider.
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
  as success while nothing was sent. There is no UI yet for entering those
  credentials — the rows must be inserted directly.
- **Outbound dialling depends on a provider implementation that does not exist.**
  `POST /api/v1/calls/[id]/dial` is wired end to end, but `HmacTelephonyProvider`
  throws on `initiateCall`; only inbound status/recording webhooks are implemented.
  A vendor-specific provider (Twilio, Vonage, …) must be added to the factory in
  `src/lib/integrations/telephony.ts` before a call can actually be placed.
- **RSVP is recorded by agents, not by invitees.** `/{workspaceSlug}/sales/events/[id]`
  lets a caller record CONFIRMED/TENTATIVE/DECLINED and reveals the Meet link on
  confirmation. There is no public self-service RSVP page; that needs a signed,
  single-use token column on `EventInvitee` rather than exposing the cuid.
- **"Square Beats" is not implemented.** No feature list, screenshots or access to
  the Square Yards application were available, so nothing was built for it.

These are explicit release gates, not hidden behind placeholder success states.
