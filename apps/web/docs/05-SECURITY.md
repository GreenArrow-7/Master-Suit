# LeadFlow CRM — Security Architecture

## 1. Threat model

The realistic attacks against a multi-tenant CRM, and what stops each.

| Threat                                                                    | Control                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant data access                                                  | `Ctx`-derived tenant + Prisma guard extension + Postgres RLS (three independent layers)                                                           |
| Horizontal escalation inside a tenant (rep reads the director's pipeline) | per-permission visibility scope, re-checked on every read _and_ write                                                                             |
| Vertical escalation (rep grants themselves a permission)                  | role rank check; a user can only administer roles with a higher rank number, and never their own                                                  |
| Mass extraction via export or report                                      | export is a permission at a scope, runs server-side over the visibility-filtered set, is audited, and produces an expiring link                   |
| Sensitive field leakage                                                   | field permissions applied in the serialiser, so masking covers API, export, report, webhook and AI paths alike                                    |
| Credential stuffing                                                       | Argon2id, per-account lockout, per-IP rate limit, generic failure message, optional MFA                                                           |
| Session theft                                                             | HttpOnly + Secure + SameSite=Lax cookie, hashed server-side, idle + absolute expiry, revocable, bound to a device label                           |
| API key leakage                                                           | prefix + Argon2id hash storage, scoped, role-bound, IP allow-listable, rotatable with overlap, revocable                                          |
| SSRF via webhooks and integrations                                        | outbound allow-list, private IP ranges blocked, DNS re-resolution pinned, 5 s timeout, no redirects followed                                      |
| Malicious upload                                                          | type + magic-byte + size checks, AV scan gate before the file is downloadable, served only via short-lived signed URLs, never from the app origin |
| Injection                                                                 | Prisma parameterisation; the filter compiler allow-lists field names and never interpolates strings                                               |
| XSS in user content                                                       | React escaping by default; landing-page custom HTML rendered in a sandboxed iframe with a separate origin and its own CSP                         |
| CSRF                                                                      | SameSite cookie + double-submit token on state-changing app routes; API-key routes are cookie-free so are not exposed                             |
| Prompt injection into the AI layer                                        | record content is passed as data, never as instructions; AI actions cannot write or send; output is labelled and logged                           |

## 2. Authentication

**Passwords.** Argon2id, `m=19456 KiB, t=2, p=1` (OWASP 2024 baseline), per-user
salt, tunable via environment. Policy is per tenant: minimum length, character
classes, reuse window over the last 5 hashes, rotation days, and a breach-list check.

**Lockout.** 5 consecutive failures locks the account for 15 minutes. The counter
resets on success. The response is identical for unknown-email, wrong-password and
locked-account, and every path performs a dummy hash so timing does not distinguish
them.

**MFA.** TOTP, `mfaEnabled` per user, `mfaRequired` per tenant. Ten single-use
recovery codes, hashed. A session that has not satisfied MFA can reach only the
MFA endpoints.

**Sessions.** 256-bit random token; only its SHA-256 is stored. Absolute TTL 8 h,
idle timeout 60 m. Cookie is `HttpOnly; Secure; SameSite=Lax; Path=/`. Users can
list and revoke their sessions; administrators can revoke a user's sessions
tenant-wide. A password change or role change revokes every other session.

**SSO.** OIDC authorization-code + PKCE. Just-in-time provisioning maps IdP groups
to roles. When a tenant enables SSO enforcement, password login is disabled except
for a designated break-glass administrator whose logins page the security contact.

## 3. Authorization

Four gates, all server-side, described in `01-PERMISSIONS.md`. The rules that matter
in code review:

- The API kernel calls `assertPermission()` **before** the handler body runs. A
  handler that reaches its first line has already passed the permission gate.
- Visibility is applied to reads by merging a `where` fragment, and re-verified on
  writes by loading the record inside the transaction and checking scope. Checking
  only on read is the classic IDOR.
- The client's `fields` and `columns` parameters can only narrow, never widen.
- `super_admin` is a provisioning role. Reading tenant record data requires a
  time-boxed break-glass grant that is itself audited and notifies the tenant.

## 4. Secrets and encryption

- In transit: TLS 1.2+ terminated at the edge, HSTS with preload, no mixed content.
- At rest: volume/disk encryption at the infrastructure layer.
- Application-layer: integration credentials, provider configs and webhook signing
  secrets are AES-256-GCM encrypted with `FIELD_ENCRYPTION_KEY`, stored with their
  key version so keys can be rotated by re-wrapping.
- Secrets come from the environment or a secret manager. Nothing sensitive is
  committed, logged, or included in an error response. The logger has a redaction
  list covering `password`, `token`, `secret`, `authorization`, `apiKey`, `otp`.

## 5. HTTP hardening

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self';
  form-action 'self'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(self), microphone=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

`geolocation=(self)` and `camera=(self)` are needed by the field-sales module and are
requested only on those routes.

## 6. Rate limiting

Sliding window in Redis, keyed at four levels. The most restrictive applies.

| Scope                  | Limit                          |
| ---------------------- | ------------------------------ |
| Login per IP           | 10 / 15 min                    |
| Login per account      | 5 / 15 min                     |
| API key                | `rateLimitPerMin`, default 600 |
| Session user           | 1 200 / min                    |
| Public form submit     | 5 / min per IP, plus CAPTCHA   |
| Export creation        | 10 / hour per user             |
| Password reset request | 3 / hour per account           |

## 7. File security

Uploads are validated on declared type, magic bytes and size, stored under
`{tenantId}/{objectType}/{recordId}/{uuid}`, and marked `scanState = PENDING`. The
AV provider interface gates download: a document that is not `CLEAN` cannot produce
a signed URL. Downloads are 5-minute pre-signed URLs issued only after the
permission and visibility check, and every issuance writes a `DOCUMENT_ACCESSED`
audit row. The bucket has no public access policy.

## 8. Audit

Append-only. No `UPDATE` or `DELETE` grant on `AuditLog` for the application role;
retention is enforced by a partition-detach job running as a separate role.

Recorded: login, logout, failed login, password change, MFA enrolment, record
create/update/delete/restore, stage change, owner change, permission change, export,
import, API-key create/revoke, automation change, integration change, document
access, sensitive-field view.

Each row carries actor (user or API key), tenant, event, object type, record id,
changed field, previous value, new value, timestamp, IP, user agent and request id.
Value diffs pass through the same field-security masking, so an audit viewer cannot
be used to read a field the viewer is not allowed to see.

## 9. Privacy

- **Consent** is stored per channel (`consentStatus`, `doNotCall`, `emailOptOut`,
  `smsOptOut`, `whatsappOptOut`) and checked in the messaging service, not in the
  UI. An automation cannot bypass it.
- **Quiet hours** per tenant and per provider defer messages rather than dropping
  them.
- **Field-sales location** is captured only at check-in and check-out, never
  continuously. It requires an administrator to enable the module, a per-user
  disclosure the user acknowledges, and a visible in-app indicator while a visit is
  open. Location history follows the tenant retention policy.
- **Data subject requests**: export-all and delete-by-identifier operate across
  every module and produce an audit trail. Deletion tombstones the record and purges
  child rows on the retention schedule.

## 10. Dependencies and CI gates

`npm audit` at high severity, secret scanning, SAST, and a dependency review run on
every pull request. The Docker image is built from `node:22-alpine`, runs as an
unprivileged user, has a read-only root filesystem, and drops all Linux capabilities.
