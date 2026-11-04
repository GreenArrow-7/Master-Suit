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
- `tests/e2e/gemini-connection-repair.spec.ts` (new, 2 cases) drives the real
  screen in a browser, on a workspace seeded into the reported state: the key
  box promises to keep a key only because one is stored, correcting the
  Provider and leaving the key box alone keeps the key and persists
  `openrouter`, the screen still says so after a reload, and a connection
  holding no key neither promises to keep one nor accepts a blank save. This
  one found a real gap the server specs could not: it is the only cover for
  what the board renders.
- `tests/hr/roster.spec.ts` — its shift-change cases pinned literal dates
  (`2026-11-02`), and `requestShiftChange` refuses a day that has passed, so
  the case failed from 2026-11-03 onward. It was the only failure in CI on this
  branch (5059 passed, 1 failed). Now relative to today via `inDays()`, which
  also defuses the two December dates beside it.
- `tests/tenant/credential-purge.spec.ts` asserts on `verify.ts`'s source
  text; its OpenRouter-branch literal was updated to `selected` and the file
  passes (23/23).
- `npm run typecheck`, `eslint` and `prettier` clean. Full `npm test`:
  **335 files, 5058 passed, 0 failed.** The 10 upload cases that first failed
  here were object storage, not this change: `infra/docker-compose.yml` still
  names `minio/minio`, which no longer pulls anonymously — CI moved to
  `adobe/s3mock` on 2026-09-24 and the compose file did not follow. Run against
  that same image locally, all 10 pass.
- **Not done:** no live call to openrouter.ai or to the affected workspace —
  this session has neither the key nor production access. The first live Test
  connection is the acceptance test.

**Left open**

- The affected workspace still holds `metadata.provider = "Open Router"`. It
  works as of this change; it is rewritten to `openrouter` the next time anyone
  saves that connection. No migration was written for one row.
- Verification proves the OpenRouter *key*, not that the configured *model* id
  exists. A wrong model id is still a 404 at the first feature call.
- `infra/docker-compose.yml` still starts `minio/minio`, so `npm run docker:up`
  cannot bring object storage up on a fresh machine. CI already uses
  `adobe/s3mock:5.2.3`; the compose file should follow. Not done here — it is a
  separate change to a file this one does not touch.
