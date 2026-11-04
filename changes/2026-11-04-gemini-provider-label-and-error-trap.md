# A Gemini connection in ERROR can be re-tested and re-saved, and "Open Router" means openrouter

**What** — Settings → Intelligence showed a workspace's Gemini connection as
`Error`, with "No API key is saved for this connection." underneath, the API key
box offering "Stored — leave empty to keep", and a Remove key button — four
statements that cannot all be true. Two defects, compounding. PR: —

**Why** — Reported from production with a screenshot. The workspace held a
valid OpenRouter key and every AI feature was silently simulating.

The first defect: the Provider box is free text and the administrator typed the
vendor's own spelling, **"Open Router"**. Nothing normalised it, so every reader
compared it to the literal `'openrouter'`, missed, and fell through to google —
the key was verified against (and would have run against) Google AI Studio,
which answers a Bearer token with "API key not valid". A good key reported dead.

The second defect: that failure parked the row in `ERROR`, and
`connectionCredentials` returns nothing unless the row is `CONNECTED`. That gate
is right for every runtime caller and wrong for the two administration paths
that read the stored key in order to re-test or re-save it. So Test connection
read no key and wrote "No API key is saved for this connection" over a row that
held one, and re-saving with the key box left blank — the documented way to keep
a key nobody can read back — merged over nothing and was refused as "API key is
required to connect." ERROR was a one-way door; neither button could leave it.

**Where**

- `lib/ai/provider.ts` — new `aiProviderKey()`: the internal key behind whatever
  was typed, `undefined` for anything that is neither provider.
- `lib/ai/gemini.ts` — `geminiProvider` reads through it, so rows already
  holding "Open Router" route correctly without a migration.
- `lib/integrations/verify.ts` — the gemini case normalises before it branches,
  so a re-test of an existing row reaches the OpenRouter check.
- `lib/integrations/connection.ts` — new `savedCredentials()` (no status gate,
  settings screen only) and `storedCredentialKeys()` (names, never values).
- `api/v1/integrations/[provider]/route.ts` — PUT and POST read through
  `savedCredentials`; PUT normalises `settings.provider` for gemini and refuses
  a third value rather than silently resolving it to google.
- `admin/integrations/page.tsx`, `components/workspace/IntegrationBoard.tsx` —
  the "Stored — leave empty to keep" hint now comes from whether a credential is
  stored, not from the connection's status.

**Behaviour** — An OpenRouter connection typed as "Open Router" verifies, and
runs, against OpenRouter. A connection in ERROR can be re-tested and re-saved
with the key box blank. The key box promises to keep a key only when one is
stored. Saving a Provider that is neither google nor openrouter is refused with
"Provider is either google or openrouter." No existing credential is read,
written or removed by any of this, and no credential value reaches the browser.

**Verified**

- `tests/unit/ai-provider-label.spec.ts` (new, 5 cases). On the old
  `verify.ts`, "honours the vendor spelling instead of testing an OpenRouter key
  against Google" fails: `expected 'That is an OpenRouter key, but Provid…' to
  contain 'no model is set'`.
- `tests/tenant/gemini-connection-error.spec.ts` (new, 5 cases) against a row in
  the exact production state. On the old code two fail: `expected {} to deeply
  equal { apiKey: 'sk-or-v1-stored' }` and `expected 'google' to be
  'openrouter'`. It also asserts the runtime still refuses an ERROR connection,
  and that one workspace never reads another's stored key.
- `tests/sales/gemini-connection-save.spec.ts` (new, 6 cases) through the real
  PUT handler with a real session: the typed label is stored as `openrouter`, a
  save from ERROR with the key box empty keeps the key and clears the error, a
  key sent empty on purpose is still refused, `openai` is refused, one
  workspace never merges another's key, and an unrelated provider's credentials
  are untouched. On the old route three fail, including `expected 422 to be
  200` for the blank-key save.
- `tests/tenant/credential-purge.spec.ts` asserts on `verify.ts`'s source
  text; its OpenRouter-branch literal was updated to `selected` and the file
  passes (23/23).
- `npm run typecheck`, `eslint` and `prettier` clean. Full `npm test`:
  5045 passed, 11 failed — `tests/sales/collections.spec.ts`,
  `tests/sales/projects-listings-le.spec.ts` and `tests/hr/roster.spec.ts`,
  all file-upload cases that 500 because MinIO is not running in this
  environment (its image cannot be pulled here). The same 11 fail on the
  untouched tree, and none of those files imports anything this change
  touches.
- **Not done:** no live call to openrouter.ai or to the affected workspace —
  this session has neither the key nor production access. The first live Test
  connection is the acceptance test.

**Left open**

- The affected workspace still holds `metadata.provider = "Open Router"`. It
  works as of this change; it is rewritten to `openrouter` the next time anyone
  saves that connection. No migration was written for one row.
- Verification proves the OpenRouter *key*, not that the configured *model* id
  exists. A wrong model id is still a 404 at the first feature call.
