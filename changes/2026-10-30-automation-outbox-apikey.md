# Automation rules fire on every edit, sign-out keeps another workspace's offline work, and a wrong API key is limited before it is hashed

**What** — three defects found by a repository audit, each a one-place fix with
a test that fails on the old code. No PR yet.

1. An automation trigger reached the queue only on a record's **first** edit.
2. Signing out deleted offline changes belonging to the person's **other**
   workspaces, which the sign-out flush cannot send.
3. A wrong API key secret was Argon2-verified **before** any rate limit applied.

**Why** — (1) and (2) each lose work silently: a workspace's rules stop running
with no error, and a completed follow-up disappears with its lead still open.
(3) let anyone holding a key's prefix — which the keys screen shows, and every
past holder of that key knows — spend the host's memory with requests that never
authenticate. Found by `/ponytail-audit`, fixed on the owner's instruction.

**Where**

- `src/services/leads/updateLead.ts`, `src/services/opportunities/updateOpportunity.ts`,
  `src/services/sla/checkLeadFirstContact.ts`, `src/services/social/escalateSocialSla.ts`
  — the four `enqueue('automation', 'trigger', …)` calls whose event can happen
  to one record twice now pass `{ fresh: true }`, the option `run-node`,
  `calendar-sync` and `lead-source.enquiry` already use. A job id is a hash of
  its payload, and `record.updated` for one lead is the same payload every time,
  so the second edit converged on the completed job BullMQ still retains
  (`removeOnComplete: 1_000`) and was dropped. The social-enquiry one was found
  by the test below rather than by the audit that prompted this change.
  `record.created` is deliberately untouched: a created record's id is one
  nothing has held before, so its payload is unique by construction.
- `src/lib/offline.ts` — `forget()` drops the signing-out owner's changes
  instead of the whole key. With no frame to name an owner it keeps everything:
  nothing can be sent under the wrong owner anyway.
- `src/lib/auth/apiKey.ts` — `consume(limits.apiKey(…))` moved above
  `verifyPassword`. An unknown prefix still costs one indexed lookup and
  nothing else; a known prefix with a wrong secret now spends that key's own
  minute budget, which is the narrow failure this limit is for.
- `tests/unit/automation-trigger-fresh.spec.ts` and
  `tests/unit/api-key-rate-limit.spec.ts`, both new. The sign-out cases went
  into `tests/unit/offline-outbox.spec.ts`, which already owns the outbox's
  behaviour and its stubs, rather than into a second file beside it.

**Behaviour** — a workspace's automation rules now run on every edit of a lead
or an opportunity, and on a repeat SLA breach after a hand-over, instead of once
per record. Signing out of one workspace no longer discards work queued offline
in another; it is sent when its own workspace is next opened. A wrong API key
is refused as before, now counted against that key's rate limit.

**Verified** — the automation spec checks the call sites themselves rather than
a list, so the next trigger is covered without editing it, and separately proves
`fresh` changes the id so the first half is not asserting a no-op. The outbox
cases queue changes as two workspaces and sign out of one. The API key spec
asserts the *order*, `['consume', 'verify']`, which is the whole defect.

Reverting the six source files and re-running fails six of those assertions —
the three that still pass are the controls that keep the others from being
vacuous. With the fixes back: 26 tests across the four files, all passing;
`npx tsc --noEmit`, `prettier --check` and `eslint` clean; and the whole
`tests/unit` suite at 1,380 passing, its only failures three files that need a
database (`cache-invalidation`, `read-replica`, `serialize`), none of which this
change touches.

One existing assertion changed with it: `offline-outbox.spec.ts` required
`forget()` to remove the storage key outright, which was true only because it
removed everyone's changes — the defect itself. It now asserts the behaviour,
that nothing of the signing-out owner is left.

**Left open** — eight further findings from the same audit are unfixed, four of
them worth doing: `monitoringPasswordHash` is missing from `SECRET_KEYS` and
`tests/security/secret-egress.spec.ts` defines a secret as a member of that set,
so it cannot detect the gap; `scrubSecrets` runs only inside `route()`, while 23
server components `include: { platformUser: true }` wholesale; `PlatformUser`
sits in both `GLOBAL_MODELS` and `SOFT_DELETE_MODELS`, where the second has no
effect; and `assertLeadCallable` admits any lead on any campaign in the
workspace, not the caller's. `AuthenticationFactor.secret` and
`IntegrationConnection.refreshToken` are never written and read as live
credential stores.
