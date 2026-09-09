# Security Observations — Phase A

Observations only. Nothing here was remediated in Phase A. An observation is
not a confirmed vulnerability unless its exploitability status says so.
Prior findings (`security/SECURITY_FINDINGS.md`, 2026-08-08) remain the
record for F-01…F-03; they are referenced, not duplicated.

Format per observation: ID · Classification · Evidence level · Component ·
Evidence · Observed behaviour · Security relevance · Exploitability ·
Required validation · Confidence · Status.

---

**SEC-OBS-001** · CSP permits inline scripts · E1 · `src/proxy.ts`
- Evidence: `script-src 'self' 'unsafe-inline'` in production (plus
  `'unsafe-eval'` outside production); `style-src 'unsafe-inline'`;
  `img-src … https:`. The file's own comment discusses nonces.
- Observed: any inline script executes; CSP does not stop reflected/stored
  XSS payloads that inject `<script>`.
- Relevance: weakens the XSS defence-in-depth layer.
- Exploitability: Possible (requires an XSS sink; none identified in Phase A).
- Validation: confirm whether Next.js nonce-based CSP is feasible with the
  current build; test `tests/security/csp` and `tests/e2e/csp` expectations.
- Confidence: High (fact), Low (impact).
- Status: Not remediated in Phase A.

**SEC-OBS-002** · Routes outside the API kernel · E1 · `src/app/api/**`
- Evidence: 38 `route.ts` files export raw handlers instead of using
  `route()`/`guarded()`; 136 use `route()`, 10 `guarded()`.
- Observed: those handlers implement auth/tenant/validation/rate-limit
  individually (health, metrics, webhooks, public forms, some auth routes,
  others not yet enumerated).
- Relevance: each is a place a check can be missing; the 2026-08-08 matrix
  in `security/APPLICATION_ATTACK_SURFACE.md` predates later routes.
- Exploitability: Unverified.
- Validation: enumerate the 38, record auth/tenant/validation per route,
  add `tests/security` coverage for any that is intentionally public.
- Confidence: High (count), Unknown (impact).
- Related evidence conflict: EVC-010.
- Status: Not remediated in Phase A.

**SEC-OBS-003** · Secrets delivered as container environment variables · E2/E4 ·
`scripts/release.sh`, `infra/docker-compose.*.yml`, `docs/DEPLOY-AZURE.md`
- Evidence: `--env-file .env.<env>` passes every variable into `web` and
  `worker`; `_FILE` support exists (`src/lib/env.ts`) but no compose file
  declares `secrets:`.
- Observed: secrets visible to `docker inspect`, `/proc/<pid>/environ`, crash
  dumps (as the project's own doc states).
- Relevance: host-level compromise or misconfigured tooling exposes all keys.
- Exploitability: Possible (needs host or container access).
- Validation: confirm production practice; decide on `_FILE` adoption.
- Confidence: High. Status: Not remediated in Phase A.

**SEC-OBS-004** · Plaintext traffic on the Compose bridge · E4 (`docs/KNOWN-LIMITATIONS.md`), E2
- Evidence: no TLS options on postgres/redis/minio/clamav/face services.
- Relevance: acceptable on one host; breaks the moment a second host or
  managed service is introduced.
- Exploitability: Not exploitable based on current evidence (single host).
- Validation: re-assess before any multi-host change.
- Confidence: High. Status: Not remediated in Phase A.

**SEC-OBS-005** · Deploy accepts an unpinned SSH host key on first use · E2 ·
`.github/workflows/deploy.yml`
- Evidence: when `DEPLOY_KNOWN_HOSTS_<ENV>` is unset the workflow warns and
  proceeds (`ssh-keyscan` pattern).
- Relevance: first-connection MITM against the deploy runner.
- Exploitability: Possible only if the secret is unset — `UNKNOWN`.
- Validation: check the GitHub environment secrets (E6).
- Confidence: High (behaviour). Status: Not remediated in Phase A.

**SEC-OBS-006** · No secret-scanning or SAST step in CI · E2 · `.github/workflows/ci.yml`
- Evidence: steps are build/test/lint/format/audit; no gitleaks, CodeQL,
  semgrep or `pip-audit`. `npm audit --omit=dev --audit-level=high` gates
  only high+ production advisories; `docs/DEPENDENCY-SECURITY.md` already
  records the missing Python scan.
- Relevance: a committed secret or a known Python CVE would not fail CI.
- Exploitability: Unverified (no committed secret found by a pattern scan of
  `src`; history not scanned in Phase A).
- Validation: one-off history scan; add gates in a later phase.
- Confidence: High. Status: Not remediated in Phase A.

**SEC-OBS-007** · pino redaction is one level deep · E1 · `src/lib/logger.ts`
- Evidence: paths like `password`, `*.password`; a secret nested two levels
  deep (`{ req: { body: { password } } }`) is not censored.
- Observed: callers are expected not to log raw bodies; `scrubSecrets` in
  the kernel covers error logs.
- Exploitability: Possible (needs a logging call that passes nested input).
- Validation: grep `logger.*(` call sites that log request bodies.
- Confidence: Medium. Status: Not remediated in Phase A.

**SEC-OBS-008** · Backups may be unencrypted · E2 · `scripts/backup.sh`
- Evidence: encryption only when `BACKUP_PASSPHRASE` is set; otherwise a
  warning. `BACKUP_REQUIRE_ENCRYPTION=1` exists to make it mandatory.
- Relevance: an off-host copy of the full dataset in clear.
- Exploitability: `UNKNOWN — requires runtime/infrastructure verification`
  (production value).
- Confidence: High (behaviour). Status: Not remediated in Phase A.

**SEC-OBS-009** · F-03 open by decision · E4 · `security/SECURITY_FINDINGS.md`
- Evidence: "an overtime approver may approve a claim they raised" — LOW,
  reported, not fixed (owner's decision).
- Status: Accepted risk recorded by the project; re-confirm in Phase B.

**SEC-OBS-010** · Public lead-capture abuse controls not traced · E1 ·
`src/app/api/v1/public/forms/route.ts`, `/f/**`
- Observed: unauthenticated POST creates `Lead`/`FormSubmission`; a
  rate-limit or captcha was not located in Phase A (the route is one of the
  38 raw handlers).
- Exploitability: Unverified.
- Validation: read the handler; confirm per-IP limits and size caps.
- Confidence: Low. Status: Not remediated in Phase A.

**SEC-OBS-011** · Mobile WebView shell shares the browser session model · E1/E2 ·
`apps/mobile`
- Evidence: cookie session inside a Capacitor WebView; any `Bearer` token to
  the API is treated as an API key by the kernel; no mobile-specific token
  family exists.
- Relevance: a native client outside the WebView cannot authenticate
  safely today; this is a design boundary, not a live weakness.
- Exploitability: Not exploitable based on current evidence.
- Status: Design note for the mobile workstream (not approved).

**SEC-OBS-012** · `allowedDevOrigins: ['**.devtunnels.ms']` · E2 · `next.config.ts`
- Relevance: development-only allowance for dev tunnels; irrelevant in
  production builds. Informational.

**SEC-OBS-013** · Positive controls worth preserving (informational)
- Three-layer tenant isolation with CI gates; argon2id + timing burn; TOTP
  + recovery codes; hashed opaque sessions with rotation/replay detection;
  envelope encryption; outbound private-address guard; signed webhooks;
  prompt redaction and AI spend caps; token-gated metrics hidden at the
  edge; mock providers refused in production; non-root container user;
  loopback-bound dev services; Redis auth enforced; `dev/outbox` gated;
  40 security spec files. E1/E2/E3.

**SEC-OBS-014** · Refused `/platform` requests return the control-plane page in the redirect body · E1/E3 · `apps/web/src/app/(platform)/platform/layout.tsx`
- Relevance: the console's only gate is its layout, and ten of its eleven
  pages assert nothing of their own. In the App Router a layout cannot stop
  the page beneath it rendering, so the refusal sets the status and location
  while the page's output is still serialised into that same response —
  workspace names, the platform owner's address, platform-wide counts and the
  platform security ledger, to an unauthenticated caller.
- Evidence: reproduced against `master-suite/web:c879c6c7f7e8`, the deployed
  image, in a disposable stack; a single unauthenticated `GET /platform`
  returns `307` with a ~31 KB body containing them. Reproduces with no cookie,
  with a company administrator's session and with an ordinary user's session.
  Not introduced by the `BUG-007` denial-UX change — the unmodified image
  behaves identically. `redirect()` and `forbidden()` both have this property.
- Counter-evidence: **8 of 8 unauthenticated probes against production
  returned a constant 23,735-byte shell containing none of it** — the page
  loses the render race there.
- Exploitability: Latent. Timing-dependent rather than mitigated; data volume,
  cache warmth and load all move it, and timing is not a control.
- Status: registered as `BUG-008`, `R4`, awaiting the gate. **Not fixed.**
  Proposed remediation: assert in each platform page so no query runs and no
  output exists, keeping the layout gate for navigation.

**SEC-OBS-015** · Lead document upload carries no MIME allowlist · E1 · `apps/web/src/app/api/v1/documents/route.ts`
- Relevance: any content type may be uploaded against a lead; the stored
  display name also keeps the raw client filename.
- Evidence: verified on the deployed image — the storage key is sanitised
  (`../../../../etc/passwd` becomes `.._.._.._.._etc_passwd`), the same
  sanitiser runs again in `Content-Disposition`, downloads are served
  `attachment` with `X-Content-Type-Options: nosniff`, size is capped, and
  ClamAV refuses an EICAR payload without storing it.
- Exploitability: Not exploitable based on current evidence — `attachment`
  plus `nosniff` is what carries it, so both are load-bearing and should not
  be removed without replacing them with an allowlist.
- Status: recorded, no change made.

## Evidence Sources

E1: `apps/web/src/proxy.ts`, `src/app/api/**`, `src/lib/logger.ts`,
`src/lib/api/handler.ts`, `src/lib/env.ts`, `next.config.ts`.
E2: `.github/workflows/ci.yml`, `deploy.yml`, `infra/docker-compose*.yml`,
`scripts/release.sh`, `scripts/backup.sh`, `apps/mobile/capacitor.config.js`.
E3: `apps/web/tests/security/*`.
E4: `security/SECURITY_FINDINGS.md`, `security/APPLICATION_ATTACK_SURFACE.md`,
`docs/KNOWN-LIMITATIONS.md`, `docs/DEPLOY-AZURE.md`, `docs/DEPENDENCY-SECURITY.md`.
