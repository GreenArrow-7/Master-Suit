# A workspace whose AI connection is broken is not moved onto the deployment's key

**What.** `geminiCredential` now tells "this workspace never connected a
provider" apart from "this workspace connected one and it is in `ERROR`". The
first still falls back to `GEMINI_API_KEY`, which is what the fallback is for.
The second does not fall back at all: it runs the assistant's template mode and
says, on screen, that the connection needs re-testing.

**Why.** The owner reported ONE AI answering "Show my overdue follow-ups" with
"AI Assistant is temporarily unavailable". Reading the resolution path for that
failure turned up a second, larger defect behind it.

`connectionCredentials` returns null unless the row is `CONNECTED` — correct,
a connection the vendor rejected must not serve features. But it returns the
same null for a provider nobody ever connected, and `geminiCredential` fell
through to the deployment key for both. So a workspace that had chosen and was
paying for its own key, and whose connection had since been marked `ERROR`, had
every AI request silently re-pointed at the platform's Google account:

- its prompts — lead notes, call transcripts, customer names — left its own
  vendor account for ours, which is the data boundary the top of `gemini.ts`
  promises bringing your own key buys;
- its spend was billed to us and counted against the shared deployment budget;
- `assertAiBudget` then applied the _deployment_ ceilings to it, so the
  workspace could be refused on an allowance it had never agreed to while its
  own key sat unused in the row;
- and the refusal surfaced as a generic outage, so nobody could see any of it.

The file's own comment already forbade this — "a shared deployment key silently
overriding that would be the opposite of what connecting it meant" — and
`connectionCredentials` already warned callers not to fall back on null. The
code did both.

**Where**

- `apps/web/src/lib/integrations/connection.ts` — `connectionState`, which
  reads status and which credential fields hold a value without decrypting.
- `apps/web/src/lib/ai/gemini.ts` — the branch above the fallback, and
  `SimulationReason` travelling on the simulated credential.
- `apps/web/src/lib/ai/assistant/service.ts` — template mode now opens by
  naming the broken connection, or the missing OpenRouter model.

**Behaviour.** Nothing changes for a workspace with a working connection, for
one that never connected a provider, or for a `DISCONNECTED` row. A workspace
whose connection is in `ERROR`
keeps getting answers — template mode reads the same permission-scoped CRM
records — but each one opens with "Your AI connection is saved but marked as
not working … use Test connection to bring it back", and no request is made on
anyone else's credential.

`ERROR` only, deliberately. `DISCONNECTED` is the status a row carries before
it has ever been verified as well as after it is switched off, so it does not
mean "this was working and now is not". `tests/tenant/gemini-key.spec.ts` pins
the deployment key as the answer there, and the first version of this change
widened the rule far enough to break it — CI caught that, 5,075 passed and 1
failed. Overturning that decision as a side effect of fixing a different one
would have been wrong, so the rule names the one status that carries the
meaning.

**Verified.** `tests/tenant/gemini-broken-connection-no-fallback.spec.ts`: with
`GEMINI_API_KEY` set, a broken connection resolves to no key and the reason
`connection-broken`; a workspace that never connected still resolves to the
deployment key; repairing the row restores the workspace key. Two of those fail
on `origin/main` — checked by restoring `main`'s `gemini.ts` and re-running, 2
failed / 4 passed — and all six pass on this branch. #240's existing
`gemini-connection-error` suite is unchanged and still green (12/12 together).
`tsc` clean.

**Left open.** This stops the silent substitution; it does not say why the
production connection went to `ERROR`. That is read off the next live attempt,
with the reference `assistantFailure` now emits.
