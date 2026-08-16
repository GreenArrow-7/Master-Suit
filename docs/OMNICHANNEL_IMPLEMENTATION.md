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
| **Phase 2A — Meta routing model + ingestion** | `8920781` | `MetaLeadFormRouting` (RLS forced), ingestion applies stage/priority/source/owner, 6 routing tests |
| **Phase 2B — Meta administration UI** | `a0e91c7` | `admin/integrations/meta`: connection, assets, capabilities, lead forms, routing drawer, webhook health, advanced |
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

3. **The password-locator fix is only half done.** `getByLabel('Password')` matched both the
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
      "Connected to the provider" on first-party channels (fixed), and 95px of horizontal
      overflow at 390px from the pre-existing IntegrationBoard health rows — a fixed 180px
      label in a non-wrapping flex row (fixed; re-measured at 0px overflow, 0 offenders).
      **Phase 1 acceptance met, desktop and mobile.**
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

**Phase 2C — Social Comment Leads.** This is now the highest priority, ahead of WhatsApp.

## PRODUCT DIRECTION CHANGED (2026-08-16)

The primary objective of the Meta integration is **capturing sales leads from Facebook and
Instagram comments**, not account connection. Connection settings are plumbing; the product
is: a prospect comments on a post/reel/ad → Master Suite captures it → qualifies intent →
routes it to a salesperson → they reply → it converts to a CRM Lead.

**The load-bearing design decision — two layers.** A social post gets `Beautiful 🔥`, `Nice`,
`😂`. Those must never reach the CRM Leads table.

    Layer 1  SocialComment / social enquiry   ← every captured comment lands here
    Layer 2  CRM Lead                          ← only on qualification, policy, or a human
                                                 pressing "Convert to Lead"

Getting this wrong pollutes the customer's CRM permanently, so it is the first thing to get
right and the last thing to compromise on.

**Build order (from the work order §76):**
1. SocialComment model + normalized webhook pipeline  ← START HERE
2. Social Leads UI (navigation: ENGAGE → Social Leads; not under Integrations settings)
3. AI intent/qualification, with visible explainability — never a bare score
4. Comment Capture configuration (Meta settings gains tabs; Lead Forms becomes one source among several)
5. Reply / private reply, gated by a provider capability layer
6. CRM Lead conversion + identity linking
7. Attribution analytics ("which post produced pipeline?")

**Hard prerequisite before writing the adapter (§8).** Verify against *current* official Meta
documentation, not memory: Graph version, comment webhook fields for `feed` (Facebook) and
`comments` (Instagram), required permissions, Page/IG-professional requirements, App Review
requirements, private-reply mechanism and its window, and rate limits. **Facebook and
Instagram differ materially** — payload shape, identity fields, private-reply behaviour — so
build provider-specific adapters behind one shared model. This programme has already shipped
one bug from trusting remembered Meta behaviour (the app-secret signature fix, `3dc45c5`);
do not repeat it.

**What already exists and must be reused, not rebuilt:**
- `webhooks/meta/[key]` receiver — signature verification, tenant resolution from the
  connection, `WebhookEvent` idempotency, queue handoff. Comments are a new `field` in the
  same envelope; extend `lib/integrations/meta/events.ts`, do not write a second receiver.
- `findDuplicates` for identity matching, `DistributionRule` for assignment, existing SLA,
  `Notification`, `Activity`, and Manath AI's authorization/context framework.
- `MetaLeadFormRouting` stays. Lead Forms becomes one acquisition source alongside FB and IG
  comments — a shared social-acquisition architecture, not a replacement.

**Schema sketch for the new model** (design against existing conventions; tenant-scoped, RLS
FORCED, `@@unique([tenantId, providerCommentId])` as the idempotency key):
tenantId, integrationConnectionId, provider, providerCommentId, providerAuthorId, authorName,
commentText, commentCreatedAt, mediaId/mediaType/permalink, parentCommentId, campaign/ad
attribution where actually supplied, intent, score, status, ownerId, teamId, linkedLeadId,
linkedContactId, repliedAt, providerReplyId.
**Store only what Meta actually supplies — never invent a phone, email or legal name.**

## VERIFIED META COMMENT CONTRACT (checked 2026-08-16, not recalled)

Sources: `developers.facebook.com/docs/graph-api/webhooks/reference/page` (feed) and
`.../reference/instagram` (comments). Graph pinned **v26.0**.

|                   | Facebook                          | Instagram                          |
|-------------------|-----------------------------------|------------------------------------|
| webhook field     | `feed`                            | `comments`                         |
| discriminator     | `value.item === 'comment'`        | the field itself                   |
| comment id        | `value.comment_id`                | `value.id`                         |
| text              | `value.message`                   | `value.text`                       |
| author            | `from.{id, name}`                 | `from.{id, username}`              |
| author id scope   | page-scoped                       | Instagram-scoped (`self_ig_scoped_id`) |
| content           | `value.post_id`                   | `value.media.{id, media_product_type}` |
| ad attribution    | not supplied                      | `value.media.{ad_id, ad_title}`    |
| edit/delete       | `value.verb` (add/edit/edited/delete/remove/…) | **not delivered**     |
| permission noted  | `pages_manage_metadata`, page admin with MODERATE | (not stated in that reference) |

**Consequences already encoded:** `feed` also carries posts/likes/shares, so non-comment
items are dropped; `verb` is Facebook-only and must stay undefined for Instagram; ad
attribution is Instagram-only; ids live in separate spaces, so the idempotency key includes
`provider`.

**Still unverified — do this before going LIVE:** exact permission set for each field,
Instagram professional-account requirements, App Review requirements, and the private-reply
mechanism and its window. The reference pages consulted did not state them. §41/§45 (reply
UI and deadline) must not be built until they are, because inventing a reply window is
exactly the class of bug this section exists to prevent.

## Phase 2C progress

**DONE (`d1187e1`) — ingestion foundation.**
- `SocialComment` model + migration `20260816180000_social_comment`, RLS FORCED (verified
  via `pg_class`), indexes for queue / owner / media-attribution / returning-commenter.
- `@@unique([tenantId, provider, providerCommentId])` idempotency key.
- `lib/integrations/meta/comments.ts` — `normalizeFacebookComment`, `normalizeInstagramComment`,
  `normalizeSocialComment(field, value)`. Never throws.
- `services/social/qualify.ts` — deterministic, no Gemini dependency, explainable reasons.
- 16 tests (`tests/sales/social-comments.spec.ts`), 34 with the Meta suite.

**DONE (`f745b6f`) — receiver wiring + worker.**
- `normalizeMetaWebhook` now emits `SOCIAL_COMMENT_RECEIVED` for `feed` and `comments`.
  **The route required no change** — it already stores + enqueues whatever the normaliser
  returns, which is why extending the shared walk was the whole job.
- Event id `comment:<provider>:<commentId>`; existing `WebhookEvent` uniqueness dedupes.
- `services/social/applySocialComment.ts` — idempotent persist, qualification, identity
  match on stable provider id (never username), assignment for HIGH/MEDIUM only,
  best-effort notification with `actionUrl` deep link.
- Facebook edit/delete verbs honoured; Instagram delivers neither, so unreachable there.
- 19 social tests; 513 across tests/sales + tests/security. tsc 0, lint 0, build green.

**Known gaps in this slice (deliberate, not oversights):**
- Assignment currently only inherits the linked lead's owner. **`DistributionRule`
  fallthrough for unknown commenters is not wired** — an unmatched HIGH enquiry lands
  unassigned in the queue. Next task after the UI.
- No realtime publish yet; the queue is read on page load.
- No Activity record on link — deliberate, to avoid flooding CRM history with unlinked
  comments (§27 leaves this to product judgment).

**DONE (`f180e44`) — Social Leads workspace.**
- Route `sales/social-leads`, nav entry under ENGAGE. Server-rendered, link-based tabs
  (shareable URLs), scoped by `visibilityWhere` with unassigned included.
- `components/workspace/SocialLeadList.tsx` — queue rows + detail drawer. Score always shown
  with its reasons. No provider ids on the row.
- **Verified through the real pipeline**, not by inserting rows: IG high→HIGH 80,
  IG praise→LOW 5, FB high→HIGH 70, a `like` dropped, redelivery deduped, **0 CRM Leads**.
- QA'd 1440px + 390px: 0 overflow, drawer full-width.
- Convert/Reply not built; the drawer says so rather than showing dead buttons.

**DONE (`84df82b`) — Convert to Lead.**
- `POST /api/v1/social-leads/[id]/convert`, drawer panel. Name required only; phone/email
  blank until collected. `findDuplicates` first — a match links and merges attribution
  without rewriting the existing `source`.
- Attribution survives: `source=CHAT`, `sourceDetail='Instagram Comment'`, and
  `customData.socialEnquiry` carrying comment text, ad id/title, media id, provider ids,
  timestamps. **This is what makes "which post produced pipeline?" answerable later.**
- Consent is `UNKNOWN`, not `IMPLIED` — a public comment is not a submitted form.
- Re-converting returns 409.
- Verified live end to end: seed → convert → 409 on repeat → attribution read back from
  the database. Demo data cleaned up.
- **Three more bare-`id` writes** were caught by the tenant guard (same class as Phase 2B).
  Rule for future work: any Prisma write addressed by `id` alone will be refused.

**DONE (`6339c82`) — distribution fallthrough.**
- `nextDistributionOwner(tenantId)` in `services/distribution/assignLead.ts` — reads the
  tenant's active ROUND_ROBIN rule, advances the pointer, refuses suspended/deleted users.
  Extracted, not copied. `assignLead` keeps its transactional variant on purpose (it must
  not advance the pointer for an already-assigned lead) — see the ponytail comment.
- **Priority order:** linked customer's owner → rotation → unassigned queue.
  No fake Lead is created to make distribution run.
- Only HIGH/MEDIUM consume capacity. Idempotent by construction — the duplicate check
  returns before assignment, so retries preserve the owner and send no second notification.
- Proven live: `dr-4 → Amina Al Rashid`, `dr-5 → Dhruv Menon` (rotation advanced),
  `dr-6 LOW → unassigned`, 2 notifications not 3. Probe data cleaned up.

**NOT DONE — next tasks in order (from the 2026-08-17 direction):**
1. **Social Lead SLA + overdue escalation** — reuse the existing SLA architecture, do not
   build a social-specific one. Clock should start from the provider comment timestamp;
   document that choice.
2. **Manual-reassignment preservation** — a manager's explicit choice must survive a retry.
   Currently safe *because* retries return early, but there is no explicit
   `assignmentSource` (auto/manual/inherited) field. Add one if reassignment UI lands.
3. **`Unassigned` filter + count** in the Social Leads UI for manager visibility.
4. **Assignment activity/history** — `LeadAssignmentHistory` is Lead-shaped; social
   assignments currently record nothing beyond `ownerId`. Needed for time-to-assignment
   analytics.
5. **Meta reply contract verification** — still BLOCKED and still unverified. Do not build
   reply UI before checking public reply, private reply, permissions, windows and App Review
   for **both** providers separately.
6. Comment Capture settings tab; AI enrichment; simulated-comment admin action.

**Old item, superseded:** DistributionRule fallthrough — an unmatched HIGH enquiry currently lands unassigned;
   `applySocialComment` only inherits a linked lead's owner.
3. Simulated comment action in demo mode (§25) — a safe admin path that goes through the
   real receiver, not a direct insert.
4. Comment Capture settings tab on the Meta page.
5. AI enrichment on top of the deterministic score — optional, must degrade.
6. Reply workflow — **still BLOCKED** on the unverified Meta private-reply contract.
7. Old item: Social Leads UI at `ENGAGE → Social Leads` (nav, queue, tabs, detail drawer).
3. AI enrichment on top of the deterministic score — optional, must degrade.
4. Comment Capture settings tab on the Meta page.
5. Reply workflow — **blocked** on the unverified private-reply contract above.
6. `Convert to Lead` + attribution preservation.

**Not started.** No further code written for this yet. The Phase 2 work below (`8920781`, `a0e91c7`)
remains valid and is unaffected.

---

**After Phase 2C: Phase 3 — WhatsApp administration.** Phases 1 and 2 are closed.

Phase 2 delivered, both halves:
- `2A` (`8920781`) — `MetaLeadFormRouting`, migration `20260816120000_meta_lead_form_routing`,
  RLS forced, ingestion honours stage/priority/source/user/team with fallthrough to the
  existing DistributionRule engine. No new assignment-strategy enum.
- `2B` (`a0e91c7`) — route `admin/integrations/meta`, API `POST /api/v1/integrations/meta`
  (`sync` | `routing` | `disconnect`), `services/meta/config.ts`,
  `components/workspace/MetaConfiguration.tsx`, `.lf-meta*` / `.lf-drawer*` CSS.
  QA'd on the running app: sync returned 3 demo forms, a rule saved and survived a full
  reload, 390px has 0 overflow with the drawer full-width and Save reachable.

**Defect the tenant guard caught during Phase 2B QA, now fixed:** two writes used a bare
`id` filter and `lib/db.ts` refused them ("issued without a tenantId filter"). Both use the
tenant-scoped composite key now. Worth remembering: that guard is load-bearing, and any new
write addressed by `id` alone will fail the same way.

**Phase 2 gaps, honestly:** there is no OAuth connect flow — the connection is created
outside the UI and the page shows/manages it. `Reconnect` is not built (Disconnect is).
Meta E2E specs are not written. Both are the first items for whoever continues Meta.

Phase 1 was closed earlier: built, QA'd at both breakpoints, both
findings fixed.

Visual QA is unblocked and this is how (nobody had this working before 2026-08-16):
Playwright cannot inject cookies, but it *can* drive the real login form — set `#email` and
`#password` through the native value setter, `form.requestSubmit()`, then navigate. Log in as
`admin@manathhomes.ae` with `DEMO_PASSWORD` from `.env`. Screenshots and DOM measurement both
work from there. Use it on every phase.

Concretely, in order:

1. Read `tests/e2e/helpers.ts` around line 60 and `prisma/seed/index.ts` around line 606.
   Determine why `PLATFORM_OWNER_PASSWORD` is rejected. Check whether the owner is being
   forced through MFA enrolment that the helper does not complete.
2. Measure the `environment-separation` timeout before changing it.
3. Build Phase 2, Meta configuration, at
   `admin/integrations/meta/`. Reuse `channelCards()` for the header state and the same
   `.lf-channel*` primitives. Lead-form routing needs new tenant-scoped storage — there is
   no model for form→pipeline mapping yet, so it needs a migration.

Commit per phase. Update this document at the end of every session.
