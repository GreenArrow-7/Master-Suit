# Error Handling

Current observed behaviour.

## Server-side exceptions

- `AppError(status, code, message)` in `src/lib/errors.ts` with
  `toProblem(requestId)`; constructors `Unauthorized` (401),
  `Forbidden` (403), `NotFound` (404), `Conflict` (409), `Invalid` (422,
  carries `FieldError[]`), `TooManyRequests` (429), `MethodNotAllowed`
  (405, subclass carrying the allowed verbs). E1.
  In the code paths inspected, user-facing failures use these constructors
  rather than a bare `Error`; this was not audited across all 173 route files.
- Domain guards throw these rather than returning error shapes:
  `assertPermission` → `Forbidden`, `resolveCtx` → `Unauthorized`,
  `assertRecordVisible` → `NotFound`, `TenantGuardError` from the Prisma
  extension (a programming error, surfaced as 500 and alerted on). E1.
- The kernel's `toResponse()` maps `AppError`, `ZodError` and unknown
  errors to `application/problem+json`; 4xx are logged at warn, 5xx at
  error with `scrubSecrets` applied to the context; the response always
  carries `x-request-id`. Audit-write failures are logged and never turn a
  403 into a 500. E1 `src/lib/api/handler.ts`.

## API error contract

See `docs/standards/API_STANDARDS.md` (RFC 9457 body, status table).
Cross-tenant and out-of-scope reads are 404 by design so the two cannot be
distinguished by a caller. E1.

## Frontend errors

- `src/app/error.tsx` and `not-found.tsx` are the App Router boundaries;
  no `global-error.tsx`. Route groups have `loading.tsx`. E1.
- Client fetches: 401 triggers one single-flight `refreshSession()` and one
  retry; a second 401 clears local auth state and notifies
  `onSessionEnded` listeners (fail closed). Other failures are surfaced by
  the calling component (`setError` patterns in forms and detail pages).
  E1 `src/lib/auth/client.ts`.
- Validation errors from 422 responses are mapped back to fields where the
  form supports it. E1 (observed in form components).

## Background jobs

- Per-queue retry policy with exponential or fixed backoff
  (`src/lib/queue.ts`); exhausted jobs stay in BullMQ's failed set
  (`removeOnFail: 5000`) and, for webhooks, in `WebhookEvent` rows an admin
  can read without Redis access. `QueueFailuresAccumulating`,
  `QueueBacklogAgeing`, `QueueHasNoConsumer` alert on the aggregate. E1/E2.
- `withRetry()` / `isTransient()` wrap selected outbound integration calls.
  E1 `src/lib/integrations/retry.ts`.

## External call failures

Outbound fetches use `AbortSignal.timeout(...)`; the face service returns an
explicit "engine unavailable" domain error with remediation text; providers
that are unconfigured are detected before use (`fcmConfigured()`,
`EMAIL_PROVIDER=smtp requires SMTP_HOST`). E1.

## Failure states surfaced to operators

`/api/health` returns 503 `degraded` when Postgres or Redis fails its 2 s
probe; `ApplicationDown` fires when the scrape target is down;
`ServerErrorRateHigh` and `RequestLatencyDegraded` cover the request path;
`TenantGuardTripped` is the isolation canary. E1/E2.

## Recommended future standard (not current)

- Add `global-error.tsx`.
- Adopt an exception tracker (none exists) so 5xx have stack-level
  visibility beyond stdout.

## Evidence Sources

E1: `apps/web/src/lib/errors.ts`, `src/lib/api/handler.ts`,
`src/lib/auth/client.ts`, `src/lib/queue.ts`,
`src/lib/integrations/retry.ts`, `src/services/hr/face.ts`,
`src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/api/health/route.ts`.
E2: `infra/prometheus-alerts.yml`.
E4: `apps/web/docs/03-API.md` §3, `docs/OBSERVABILITY.md`.
