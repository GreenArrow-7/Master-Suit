# API Standards

Current observed conventions. `apps/web/docs/03-API.md` is the existing
detailed reference and remains authoritative where it matches the code;
differences are noted.

## Routing

- Path-versioned under `/api/v1`; 170 route files. Next App Router file
  convention (`src/app/api/v1/<resource>/[id]/route.ts`), HTTP verb exports.
  Operational endpoints outside the version: `/api/health`,
  `/api/health/live`, `/api/metrics`. E1.
- Resources are plural kebab-case (`follow-ups`, `social-leads`,
  `commission-slabs`); sub-resources nest (`workspaces/[workspaceId]/access`).
  E1.
- v1 is additive-only; a breaking change opens v2. DOCUMENTED
  (`03-API.md` §2); no v2 exists.

## Handler shape

```ts
export const GET = route(
  { module: 'leads', action: 'VIEW', query: leadListQuery, auditEvent: … },
  async ({ ctx, query, requestId }) => { … },
);
```
The kernel supplies request id, credential resolution, rate limiting, module
entitlement, permission, Zod parsing, audit and error mapping
(`docs/architecture/BACKEND.md`). 136 files use it; 10 use `guarded()`; 38
are raw handlers (webhooks, health, metrics, public forms, some auth) that
implement their own checks. E1.

## Authentication and authorization

| Caller | Credential |
|---|---|
| Browser | `lf_session` cookie (`credentials: 'same-origin'`) |
| Integrator | `Authorization: Bearer lf_live_<prefix>_<secret>` |
| Platform service | `Authorization: Bearer lf_svc_…` → `lf_service_session` |

The tenant is never accepted from the URL, a header or the body; it comes
from the credential. Permission is `module` + `action` with a scope; record
visibility and field rules are applied server-side. E1.

## Request validation

Zod schemas per route for `params`, `query`, `body`. Failures produce 422
with a `errors: [{field, code, message}]` array. Unknown fields follow the
schema's own policy (no global `.strict()` convention observed). E1.

## Pagination

Cursor (keyset) only: `?limit=<1..200, default 50>&cursor=<opaque base64url>`;
responses carry `nextCursor`. OFFSET is deliberately not offered. E1
`src/lib/api/pagination.ts`.

## Filtering, sorting, sparse fields

`?filter=<base64 filter tree>` or repeated `?f.<field>[.op]=value`;
`?sort=-updatedAt,fullName`; `?fields=a,b,c`. Filterable fields are checked
against field permissions (`assertFilterableFields`). E1
`src/lib/api/filterTree.ts`, `where.ts`; DOCUMENTED `03-API.md` §2, §5.

## Response format

- Success: JSON body (or a `Response` the handler builds), always with
  `x-request-id`. Handlers returning nothing yield `{ ok: true }`.
- Errors: RFC 9457 `application/problem+json` with `type`, `title`,
  `status`, `detail`, `requestId`, and `errors` for validation.
- Status usage: 400 malformed · 401 no/invalid credential · 403
  authenticated but not permitted · 404 outside tenant **or** outside
  visibility (indistinguishable by design) · 409 conflict/version/duplicate ·
  422 validation · 429 rate limited · 5xx logged with scrubbed context.
  E1 `src/lib/errors.ts`, `handler.ts`; DOCUMENTED `03-API.md` §3.

## Idempotency and concurrency

`Idempotency-Key` on POST/PATCH (stored 24 h, replays return the original
response) and `If-Match: <version>` on PATCH are DOCUMENTED in `03-API.md`
§2. The storage/enforcement path was not traced in Phase A —
`INFERRED — requires verification` before relying on it. Evidence conflict:
**EVC-008**.

## Rate limits

Per-route `rateLimit` specs, plus API-key (`API_RATE_LIMIT_PER_MIN`) and
session-user ceilings; auth routes have their own limits
(`docs/security/AUTHENTICATION.md`). Fixed windows in Redis. E1.

## Webhooks

Inbound: `/api/v1/webhooks/telephony`, `/telephony/[key]`,
`/telephony/[key]/answer`, `/webhooks/meta/[key]` — signature verified,
tenant from the connection key, events recorded. Outbound: `WebhookEvent`
+ `webhook` queue, 5 attempts with exponential backoff, signed with
`WEBHOOK_SIGNING_PEPPER` (construction not traced). E1.

## API documentation

`npm run openapi` is declared in `package.json` but
`scripts/generate-openapi.ts` is **absent** from the repository — the script
would fail. Recorded as **EVC-006** and gap GAP-ARCH-03. E2.

## Recommended future standard (not current)

- Restore or remove the `openapi` script; if restored, generate the spec in
  CI so it cannot drift.
- Publish a per-route authorization matrix generated from the specs
  (supersedes the hand-maintained `security/APPLICATION_ATTACK_SURFACE.md`).
- Bring the 38 raw handlers under the kernel or document why each is exempt.

## Evidence Sources

E1: `apps/web/src/lib/api/*`, `src/lib/errors.ts`, `src/app/api/**/route.ts`,
`src/lib/security/ratelimit.ts`, `src/workers/webhook.ts`.
E2: `apps/web/package.json`, `.github/workflows/ci.yml`.
E4: `apps/web/docs/03-API.md`, `security/APPLICATION_ATTACK_SURFACE.md`.
Unverified: idempotency-key storage, outbound signature construction.
