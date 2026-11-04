# Hotfix: a Gemini connection in ERROR can be re-tested and re-saved, and "Open Router" means openrouter

**What** — The same fix as PR #240, cut from the production commit instead of
from `main`, so the repair can be released without the 43 merged PRs and 25
migrations that have accumulated on `main` since 11 Oct. Source changes are
identical; no migration, no dependency, no feature from those 43 PRs is needed.
Branch `hotfix/gemini-provider-openrouter`, from `f9c0c1a`.

**Why** — Settings → Intelligence showed one workspace's Gemini connection as
`Error`, with "No API key is saved for this connection." underneath, the API key
box offering "Stored — leave empty to keep", and a Remove key button — four
statements that cannot all be true. Two defects, compounding.

The Provider box is free text and the administrator typed the vendor's own
spelling, **"Open Router"**. Every reader compared it to the literal
`'openrouter'`, missed, and fell through to google, so the OpenRouter key was
checked against Google AI Studio, which answers a Bearer token with "API key not
valid". A good key reported dead, and every AI feature silently simulating.

That parked the row in `ERROR`, and `connectionCredentials` returns nothing
unless the row is `CONNECTED` — right for every runtime caller, wrong for the
two administration paths that read the stored key in order to re-test or
re-save it. Test connection then read no key and wrote "No API key is saved"
over a row that held one, and re-saving with the key box blank was refused as
"API key is required to connect."

**Where** — the same five changes as #240:

- `lib/ai/provider.ts` — new `aiProviderKey()`.
- `lib/ai/gemini.ts`, `lib/integrations/verify.ts` — read the provider through
  it, so rows already holding "Open Router" route correctly with no migration.
- `lib/integrations/connection.ts` — `savedCredentials()` (no status gate,
  settings screen only) and `storedCredentialKeys()`.
- `api/v1/integrations/[provider]/route.ts` — both administration paths read
  through `savedCredentials`; PUT normalises `settings.provider` and refuses a
  third value.
- `admin/integrations/page.tsx`, `components/workspace/IntegrationBoard.tsx` —
  the "Stored — leave empty to keep" hint comes from whether a credential is
  stored, not from the status.

**What differs from #240, and why** — two import hunks conflicted and were
resolved *down*, not merged:

- `verify.ts` — #240's hunk carried a `./calendar` import belonging to the
  Google/Outlook calendar sync (#221, #228). This baseline has no calendar case
  in `verify.ts`; the import was dropped.
- `admin/integrations/page.tsx` — #240's hunk carried `calendarSync`,
  `isAppUserAgent` and `next/headers` imports, and a return object with
  `settingFields`/`settings` from `withSwitches`, `manageHref` and `oauth`. All
  of those belong to later features. The baseline's return object was kept
  as-is and one field added: `storedCredentials`.

Nothing else from the 43 PRs was taken. `npm run typecheck` passes on this
baseline, which is the evidence that the fix stands alone.

**Behaviour** — An OpenRouter connection typed as "Open Router" verifies, and
runs, against OpenRouter. A connection in ERROR can be re-tested and re-saved
with the key box blank. The key box promises to keep a key only when one is
stored. A Provider that is neither is refused. No credential is read, written
or removed by any of this, and no credential value reaches the browser.

**Verified** — on the production baseline, against the production schema
version (101 migrations), with object storage running:

- `tests/unit/ai-provider-label.spec.ts` (5), `tests/tenant/gemini-connection-error.spec.ts`
  (6), `tests/sales/gemini-connection-save.spec.ts` (6, written against the
  helpers this release has — `put` and `helpers/leadSource` came later),
  `tests/e2e/gemini-connection-repair.spec.ts` (2, the real screen in a browser).
- The defect was first **reproduced** on this baseline before the fix: a
  blank-key save answered 422 "API key is required to connect.", and
  `geminiProvider` returned `google` for a connection whose Provider read
  "Open Router".
- `tests/hr/roster.spec.ts` pinned literal dates for its shift-change cases and
  `requestShiftChange` refuses a day that has passed, so `2026-11-02` fails from
  2026-11-03 onward — on this baseline as on `main`. Test-only, no production
  behaviour, included because CI cannot go green without it.
- `tests/tenant/credential-purge.spec.ts` asserts on `verify.ts`'s source text;
  its OpenRouter-branch literal was updated to `selected`.
- Typecheck, lint (0 errors) and format clean. Full `npm test` on this baseline:
  see the PR.

**Migration delta: 0.** No file under `prisma/migrations` is touched, and the
schema is unchanged. Production stays at 101 migrations, so rollback to the
current image needs no down-migration.

**Left open**

- Which commit production actually runs is **not verified here**. The app
  reports it as `build <sha>` at the top of Admin → Integrations. This branch is
  cut from `f9c0c1a` because that is what `changes/PROJECT.md` records and its
  101 migrations match; if the running build is newer, the same five hunks apply
  there unchanged (they are already on `main` as #240).
- Verification proves the OpenRouter *key*, not that the configured *model* id
  exists. A wrong model id is still a 404 at the first feature call.
- `infra/docker-compose.yml` still starts `minio/minio`, which no longer pulls
  anonymously; CI moved to `adobe/s3mock:5.2.3`. Not touched here.
