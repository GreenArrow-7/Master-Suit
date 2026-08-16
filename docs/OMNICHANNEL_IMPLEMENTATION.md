# Omnichannel Customer Engagement — Implementation State

Continuation document for a multi-session enterprise programme. **Read this before
touching the code.** It exists so a new session does not spend half its context
rediscovering the architecture (§29 of the work order).

Branch: `feat/omnichannel-conversation-spine` → PR #2 against `main`.
Last updated: 2026-08-15 (Phase 1 UI complete).

---

## 1. The one-paragraph architecture

Inbound events from Meta (Lead Ads, WhatsApp, Instagram) hit a **webhook receiver**
that authenticates them, **normalises** them into one internal vocabulary, stores
them idempotently, and hands them to a **queue worker** that writes CRM records.
Outbound messages go the other way through a **provider adapter**. Everything is
tenant-scoped by an `IntegrationConnection` row, and every table is protected by
Postgres RLS as well as an application-level tenant guard.

```
Provider → webhooks/meta/[key] → verify signature → normalise → WebhookEvent (idempotent)
                                                                      ↓
                                                              queue: webhook
                                                                      ↓
                                    applyMetaEvent → Lead | Conversation | delivery receipt
                                                                      ↓
                                              distribution + automation queues → notification
```

### Load-bearing pieces that already existed (do NOT rebuild)

| Concern | Where | Note |
|---|---|---|
| Provider registry | `src/lib/integrations/registry.ts` | `PROVIDERS[]` — credentials/settings split, capabilities, webhook flag. Adding a vendor is an adapter + an entry here. |
| Per-tenant credentials | `IntegrationConnection` | `@@unique([tenantId, provider])`, `webhookKey`, `status`, `scopes`, `expiresAt` |
| Secret encryption | `src/lib/integrations/connection.ts` | AES-256-GCM envelope per value; the **only** place credentials decrypt |
| Idempotency | `WebhookEvent` | `@@unique([tenantId, provider, externalId])` |
| RBAC row scoping | `src/lib/security/visibility.ts` | `visibilityWhere(ctx, module, action, opts)` — use this, never hand-roll |
| Duplicate detection | `src/services/leads/findDuplicates.ts` | Tenant-configurable via `DuplicateRule`, confidence-scored |
| Queues | `src/lib/queue.ts`, `src/workers/` | BullMQ; `webhook` queue = 5 attempts, exponential backoff |
| Audit | `src/lib/security/audit.ts` | Records method/path/recordId only — **never request bodies** |

### Added by this programme

| Thing | Where |
|---|---|
| `Conversation` model | `prisma/schema.prisma` + migration `20260814200000_conversation_spine` |
| Event normalisation | `src/lib/integrations/meta/events.ts` |
| Webhook receiver | `src/app/api/v1/webhooks/meta/[key]/route.ts` |
| Event → CRM | `src/services/meta/applyEvent.ts`, `src/workers/webhook.ts` |
| Conversation APIs | `src/app/api/v1/conversations/` |
| Template sync | `src/services/meta/templates.ts`, `src/app/api/v1/whatsapp/templates/route.ts` |
| Inbox UI | `src/components/communications/ConversationInbox.tsx` |

---

## 2. Completed phases

| Phase | Commit | What |
|---|---|---|
| 0 — Security fix | `3dc45c5` | Meta webhook signatures keyed with **app secret**, not verify token. Graph pinned `v26.0`. |
| 1 — Spine + dedupe | `f607402` `a54069d` `41f1f1f` | `Conversation` model (RLS forced, verified via `pg_class`); public form now runs `findDuplicates`; `FormSubmission.utm` populated |
| 2 — Receiver | `83299db` | Meta webhook GET handshake + POST signature verify + normalisation + idempotent store |
| 3 — Event → CRM | `aacaad3` | Lead Ads → Lead (Graph `field_data` retrieval), inbound WhatsApp → Conversation, ranked delivery receipts |
| 4 — Conversation APIs + Inbox | `738a371` `e802412` | List/thread/send APIs, 24h service window enforced server-side, 3-column inbox |
| 5 — Templates | `087e327` | Meta template sync, approval state verbatim, template send re-read server-side |
| CI | `1a012e2` (on `main`), `c66bbfd`, `efdcedf` | Format gate on main; E2E password locator; mojibake |
| **UI 1 — Channel control centre** | `a586491` | `Settings → Integrations` channel overview: 4 cards, derived state, LIVE/SIMULATED/NOT CONFIGURED, setup checklist |

### Decisions worth not relitigating

- **`sent` ≠ `delivered`.** Meta accepting a message is not a handset receiving it.
- **Status idempotency key is `messageId:STATUS`** — one message emits sent/delivered/read against the same `wamid`.
- **The leadgen webhook carries no `campaign_id`** — only `ad_id`/`adgroup_id`. Campaign attribution needs a follow-up Graph call. A test pins this absence.
- **Attribution merges into `Lead.customData`**, never replaces it, and never rewrites `source` on an existing lead.
- **Templates are re-read from the DB at send time** — a client naming a template + body could otherwise send unreviewed content under an approved name.
- **No `ConversationParticipant` model** — every channel here is one business to one customer.

---

## 3. Current state

### Local gate results (last full run)

| Gate | Result |
|---|---|
| Typecheck | PASS (0 source errors) |
| Lint | PASS (0 errors, 132 pre-existing `no-explicit-any` warnings) |
| Format | PASS on the 24 files this branch touches |
| Unit | **1086 / 1087** — see Known Issues |
| Server integration | PASS (2 files, 6 tests) |
| E2E | **FAIL — 6 of 32** — see Known Issues |
| Production build | PASS (73 pages) |
| **Remote CI** | **UNVERIFIED — `gh` unauthenticated, repo private** |

> `format:check` reports ~362 files locally. That is a Windows artefact: `core.autocrlf=true`
> gives the working tree CRLF while Prettier expects LF. Blobs are stored LF and CI is clean.
> Verify with `git show <ref>:<path>` — but note `git show` **re-applies the CRLF filter on
> output**, so pipe through `dos2unix` or use `git cat-file` before checking.

### Known issues (real defects, not classified as green)

1. **E2E: 6 specs fail at owner sign-in.** Symptom: reaches the MFA screen, then
   `"That email and password combination did not work."` for `owner@masterapp.local`.
   Ruled out: local seed state (reseeding changed nothing), a stale MFA factor (the only
   verified factor belongs to a leftover `e2e.owner.*` account, not the owner), CRLF.
   **Next probe:** `tests/e2e/helpers.ts:60` reads `PLATFORM_OWNER_PASSWORD`; the seed writes
   `process.env.PLATFORM_OWNER_PASSWORD ?? DEMO_PASSWORD`. They read the same variable and
   should agree. Establish why they don't — that is the whole bug.
   Note: an untracked `apps/web/scripts/owner-mfa-snapshot.mjs` appeared in the working tree
   from a concurrent session, apparently investigating the same thing.

2. **`tests/unit/environment-separation.spec.ts` times out** at 30s under full-suite
   parallelism; passes alone in 10s. It spawns the seed as a child process. **Do not just
   raise the timeout.** Measure first: instrument the spawn, check whether concurrent vitest
   workers contend on the same database or on process startup. This test protects demo/prod
   isolation and matters.

3. **Horizontal overflow at 390px on `Settings → Integrations`.** 95px. The offending
   element is `.lf-card` (454px) inside the **pre-existing IntegrationBoard health
   section** — not the Phase 1 `.lf-channel` cards, which collapse correctly. §33 forbids
   horizontal page overflow, so this blocks the mobile acceptance item for this page.
   Fix belongs in `IntegrationBoard`/`.lf-card`, likely `min-width: 0` on the grid child
   plus `overflow-x: auto` on the health table.

4. **The password-locator fix is only half done.** `getByLabel('Password')` matched both the
   input and a `Show password` eye button. Tests now pass `{ exact: true }` (measured: 10 → 6
   failures). Per §74 the **component semantics** still need review — the eye button's
   accessible name colliding with the field's label is a UX problem, not only a test problem.
   Consider `aria-label="Show password characters"` or moving it out of the label association.

---

## 4. Not started — the in-app configuration programme

**None of the admin UI in the work order exists yet.** This is the gap the customer named:
the backend is real, the administrator cannot see or operate it.

- [x] **Phase 1 — `Settings → Integrations` overview.** DONE (`a586491`). Four cards, state
      derived from `IntegrationConnection` / `WebhookEvent` / `MessageTemplate` /
      `Form`+`FormSubmission`, setup checklist, mode chip. **Extends** the existing vendor
      board on the same route — do not create a second Integrations destination.
      Files: `src/services/integrations/channelState.ts`,
      `src/components/workspace/ChannelOverview.tsx`, `.lf-channel*` / `.lf-setup*` in
      `globals.css`. **Outstanding: screenshot QA at 1440px and 390px (§33).**
      Cards currently link `Manage` to the same page; per-channel destinations arrive with
      Phases 2/3/5.
      **QA done 2026-08-16** at 1440px and 390px via Playwright (log in through the real
      form as `admin@manathhomes.ae` / `DEMO_PASSWORD`; cookie injection is blocked but a
      form login works). Desktop renders correctly. Two findings: LIVE copy said
      "Connected to the provider" on first-party channels (fixed), and the 390px overflow
      above (pre-existing, not fixed).
- [ ] **Phase 2 — Meta configuration** + guided connect, page/IG selection, lead forms,
      lead routing, permissions, webhook health, reconnect.
- [ ] **Phase 3 — WhatsApp control centre** + setup wizard, templates screen, conversation
      routing, test connection.
- [ ] **Phase 4 — Inbox discoverability.** Nav entry is committed (`WorkspaceSidebar`, under
      ENGAGE) but the surrounding IA and channel filters are unfinished.
- [ ] **Phase 5 — Website admin.** Domains + verification, form embed, API keys (secret shown
      once), lead routing, attribution, recent submissions.
- [ ] **Phase 6 — Notifications.** Org config, personal preferences, quiet hours, web push,
      honest PWA-vs-native statement.
- [ ] **Phase 7 — Health + webhook operations** with safe metadata and idempotent retry.
- [ ] **Phase 8 — Communication routing.**
- [ ] **Phase 9 — Observability.**
- [ ] **Phase 10 — Full E2E, mobile, RBAC, tenant-isolation, load testing with p50/p95/p99.**

### Where the data for Phase 1 already lives

Everything the overview needs exists — no new tables required:

- Status/mode → `IntegrationConnection.status`, and whether credentials resolve to a real
  provider or the mock (`getWhatsAppProvider` falls back to `MockWhatsAppProvider`).
- Last event → `WebhookEvent` ordered by `createdAt` per `provider`.
- Webhook health → `WebhookEvent.processed` / `errorMessage` / `attempts`.
- Templates count → `MessageTemplate` where `channel='WHATSAPP'`.
- Website → `Form`, `FormSubmission` (has `utm`, `referrerUrl`), plus `Domain` work not yet built.
- Notifications → `Notification`, `CommunicationProvider.quietHours`.

**Permission to gate on:** `integrations` / `MANAGE_CONFIGURATION` for writes,
`integrations` / `VIEW` for the overview. Both already exist in `prisma/seed/roles.ts`.

---

## 5. External blockers (cannot be cleared from code)

- Meta App Review for `leads_retrieval`, `ads_management`, `pages_read_engagement`,
  `pages_manage_metadata`, plus **Business Verification**.
- WhatsApp Business Account, registered number, and **template approval**.
- Instagram professional account linked to the Page.
- VAPID keypair for web push. FCM/APNs only if a native app exists — **no evidence one does**;
  document PWA honestly rather than claiming native push.
- `wabaId` must be added per tenant in the integrations UI; it is **not** the phone number id.

---

## 6. Verification constraints in this environment

- **Remote CI is unreadable** — `gh` unauthenticated, repo private. Run the gates locally in
  CI's order instead: typecheck → lint → format:check → test → test:server → e2e → build.
- **The in-app browser pane stalls streamed RSC pages.** It reports blank/"Loading" for pages
  that the server rendered correctly in ~200ms. Do not diagnose from it.
- **Playwright's context blocks cookies**, so it cannot reach authenticated routes by injecting
  a session. Use the E2E helpers' real login flow instead.
- Consequence: **no screenshot of an authenticated screen has been captured this session.**
  §33 screenshot QA is outstanding for every UI phase.

---

## 7. Next recommended task

**Fix the E2E owner sign-in (Known Issue 1), then build Phase 2 (Meta configuration).**

Concretely, in order:

1. Read `tests/e2e/helpers.ts` around line 60 and `prisma/seed/index.ts` around line 606.
   Determine why `PLATFORM_OWNER_PASSWORD` is rejected. Check whether the owner is being
   forced through MFA enrolment that the helper does not complete.
2. Measure the `environment-separation` timeout before changing it.
3. Screenshot the Phase 1 overview at 1440px and 390px via Playwright — this is the one
   acceptance item Phase 1 has not met.
4. Build Phase 2, Meta configuration, at
   `admin/integrations/meta/`. Reuse `channelCards()` for the header state and the same
   `.lf-channel*` primitives. Lead-form routing needs new tenant-scoped storage — there is
   no model for form→pipeline mapping yet, so it needs a migration.

Commit per phase. Update this document at the end of every session.
