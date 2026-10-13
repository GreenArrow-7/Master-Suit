# LeadFlow CRM — API Structure

Base path `/api/v1`. OpenAPI 3.1 generated from the Zod schemas at
`/api/v1/openapi.json`, browsable at `/api-docs`. Every route goes through the same
kernel (`src/lib/api/handler.ts`); a route that does not is a review blocker.

## 1. Request pipeline

```
request
  → requestId (a UUID, echoed as X-Request-Id, stamped on every audit + log line)
  → rate limit (Redis sliding window; per API key, per user, per IP)
  → authenticate (session cookie | Bearer API key | OIDC bearer)
  → resolve Ctx (tenant, actor, role, permission map, visibility sets)
  → IP allowlist check (tenant + key level)
  → assertPermission(module, action)
  → validate (Zod: params, query, body)
  → strip fields the actor may not write
  → handler
  → apply field security to the response
  → audit (if the route declares an audit event)
  → serialise
```

## 2. Conventions

| Concern       | Rule                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| Auth          | `Cookie: lf_session` for the app; `Authorization: Bearer lf_live_…` for API keys           |
| Tenant        | Never in the URL or a header. Derived from the credential. A request cannot name a tenant. |
| Pagination    | Cursor: `?limit=50&cursor=<opaque>`. Response carries `nextCursor`. Offset is not offered. |
| Filtering     | `?filter=<base64 filter tree>` or repeated `?f.stage=qualified&f.score.gte=70`             |
| Sorting       | `?sort=-updatedAt,fullName`                                                                |
| Sparse fields | `?fields=id,fullName,stage,owner`                                                          |
| Idempotency   | `Idempotency-Key` on a JSON POST/PATCH: 24 h, the first answer replayed; reused → 409      |
| Concurrency   | `If-Match: <version>` on PATCH; mismatch returns 409                                       |
| Errors        | RFC 9457 problem+json                                                                      |
| Versioning    | Path-versioned. v1 is additive-only; breaking changes open v2.                             |

## 3. Error shape

```json
{
  "type": "https://docs.leadflow.example/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "2 fields failed validation",
  "requestId": "01J8ZQ2K9M7X",
  "errors": [
    { "field": "email", "code": "invalid_format", "message": "Enter a valid email address" },
    { "field": "stageId", "code": "not_found", "message": "Stage no longer exists" }
  ]
}
```

| Status | When                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 400    | malformed request                                                                                                         |
| 401    | no or invalid credential                                                                                                  |
| 403    | authenticated but lacks permission or scope                                                                               |
| 404    | record outside the actor's tenant **or** outside their visibility — the two are indistinguishable to the caller by design |
| 409    | version conflict, duplicate blocked, illegal stage transition                                                             |
| 422    | validation failed                                                                                                         |
| 429    | rate limited; `Retry-After` set                                                                                           |
| 503    | provider unavailable, job queue saturated                                                                                 |

Returning 404 rather than 403 for out-of-scope records is deliberate: a 403 confirms
the record exists, which is itself a leak across tenants.

## 4. Route surface

```
POST   /auth/login                 PATCH  /leads/bulk
POST   /auth/logout                POST   /leads/import
POST   /auth/refresh               POST   /leads/export
POST   /auth/forgot-password       POST   /leads/{id}/merge
POST   /auth/reset-password        POST   /leads/{id}/convert
POST   /auth/mfa/enroll            GET    /leads/{id}/timeline
POST   /auth/mfa/verify            GET    /leads/{id}/duplicates
GET    /auth/sessions              POST   /leads/{id}/assign
DELETE /auth/sessions/{id}

GET    /leads                      GET    /opportunities
POST   /leads                      POST   /opportunities
GET    /leads/{id}                 GET    /opportunities/{id}
PATCH  /leads/{id}                 PATCH  /opportunities/{id}
DELETE /leads/{id}                 POST   /opportunities/{id}/stage
                                   POST   /opportunities/{id}/close

GET|POST /accounts   /contacts   /activities   /tasks   /products   /tickets
GET|POST /campaigns  /lists      /forms        /landing-pages       /documents
GET|POST /smart-views /reports   /dashboards   /automations         /distribution-rules

GET    /search?q=                  global, permission-aware, grouped by object
GET    /notifications              PATCH /notifications/{id}/read
GET    /audit-logs                 POST  /audit-logs/export

POST   /admin/users                PATCH /admin/roles/{id}/permissions
POST   /admin/api-keys             DELETE /admin/api-keys/{id}
POST   /admin/webhooks             POST  /admin/webhooks/{id}/test
GET    /admin/settings             PATCH /admin/settings

POST   /public/forms/{key}/submit  unauthenticated, CAPTCHA + rate limited
POST   /webhooks/inbound/{key}     signature-verified provider callbacks
POST   /webhooks/leads/{key}       lead sources: portals, Google Ads, Custom webhook, Portal emails (§6)
```

## 5. Filter tree

One grammar drives the grid, Smart Views, dynamic lists, automation conditions,
report filters and distribution rules. Written once, tested once.

```json
{
  "op": "AND",
  "children": [
    { "field": "stage.key", "cmp": "in", "value": ["qualified", "proposal_sent"] },
    { "field": "score", "cmp": "gte", "value": 70 },
    {
      "op": "OR",
      "children": [
        { "field": "owner.id", "cmp": "eq", "value": "$currentUser" },
        { "field": "owner.teamId", "cmp": "in", "value": "$currentUserTeams" }
      ]
    },
    { "field": "createdAt", "cmp": "relative", "value": "last_30_days" },
    { "field": "custom.budget_aed", "cmp": "gte", "value": 500000 }
  ]
}
```

Comparators: `eq ne gt gte lt lte in nin contains starts ends between is_null
is_not_null relative changed_to changed_from`.

Relative dates: `today yesterday this_week last_week this_month last_month
this_quarter this_year last_n_days next_n_days overdue`.

Compilation is allow-listed — a field name that is not in the object's registered
field map is rejected before it reaches SQL. There is no string interpolation into
the query anywhere in the compiler.

## 6. Webhooks

Signed with HMAC-SHA256 over `{timestamp}.{body}`:

```
X-LeadFlow-Event: lead.stage_changed
X-LeadFlow-Delivery: 01J8ZQ2K9M7X
X-LeadFlow-Timestamp: 1753545600
X-LeadFlow-Signature: v1=6f3a…
```

Consumers must reject a timestamp older than 5 minutes and compare signatures in
constant time. Retry ladder 10 s → 1 m → 5 m → 30 m → 2 h; after five failures the
endpoint is disabled and the tenant administrator is notified.

Events: `lead.created` `lead.updated` `lead.stage_changed` `lead.assigned`
`opportunity.created` `opportunity.stage_changed` `opportunity.won`
`opportunity.lost` `task.completed` `form.submitted` `ticket.created`
`ticket.resolved`.

### Inbound: lead sources

`POST /api/v1/webhooks/leads/{key}` takes enquiries from the property portals,
Google Ads lead forms and any other sender, connected as a **Custom webhook**
(Admin → Integrations → Lead sources). A Custom webhook's signing secret is
issued when it is connected and shown once.

- Sign the raw body: `X-Signature: sha256=<hex HMAC-SHA256 of the body>`.
- Send an `Idempotency-Key`: a retry under the same key stores nothing new and
  is answered 200 like the first; the same key with a different body is 409.
  A body already received is the same delivery under any key.
- The body is a JSON object. Read by default: `name` (or `first_name` and
  `last_name`), `phone`, `email`, `message`, `source_detail`. Any other
  field is read through the source's field mapping (`parent.field` for a
  nested one).
- 200 `{}` means stored; the worker makes the lead. Every delivery is on the
  source's Deliveries tab with what became of it, and can be replayed there
  once the queue is done with it.

**Portal emails** (a lead source connected like a Custom webhook, its secret
issued and shown once) take the lead emails Property Finder, Bayut and dubizzle
send an agency. No inbound-mail service posts this body as it is: the workspace
runs one (SES, Mailgun, Postmark, SendGrid Inbound Parse, or a mail-server
worker) with a small relay that turns each received email into
`{ "from", "to", "subject", "text", "html", "messageId" }` and posts it, signed
as above (at most 256 KB in all). `messageId` is the delivery's identity, over
any `Idempotency-Key`: the same email again makes nothing new. The portal is
the one the sender names, else the sender a forwarded email quotes, else the
subject; a portal named only in the body is not enough. `text` is read, else
`html` when `text` gives nobody to contact. A forwarded email is read from
its quoted header down (the forwarder's note and signature are not the
client's). The `Label: value` lines (or an HTML table of label and value
cells) give the name, one phone, email, reference and message; lines under a
label or heading about the agent, broker or owner are not read as the client's,
and of several numbers the first under a client label is kept, else the first
in the email. The field mapping names a label the parser does not know. The
lead takes that portal's source, `sourceDetail` (`bayut:<reference>`) and
catalogue entry. Any other email, or one with no phone or email in it, is kept
and shown on Deliveries as _Not read: unknown email_.

`Idempotency-Key` on the API itself (§2): per workspace, method and path, by
the same caller; a retry with the same body gets the first 2xx answer back
without running again, and a different body or caller under the key is 409.
Routes whose answer is a credential shown once, or whose body carries a
password, ignore it: your own password and two-factor (`identity/self`), and an
administrator's password reset and account creation (`identity/{action}`).

## 7. API keys

Format `lf_live_<8-char prefix>_<32-char secret>`. Only the prefix is stored in
clear; the secret is Argon2id-hashed. The full key is shown once at creation.

A key carries a role, so it can never exceed what that role may do. Scopes narrow
further (`leads:read`, `leads:write`). Rotation issues a new key linked by
`rotatedFromId` and leaves a 24-hour overlap before the old key is revoked.
