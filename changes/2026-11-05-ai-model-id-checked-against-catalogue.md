# The AI Model box takes a catalogue id, not a display name

**What.** Saving the Gemini/OpenRouter connection checks the Model value
against the selected provider's own model list before anything is written. An
id that is not listed, or cannot call tools, is refused (422) and the stored
row is left exactly as it was. If the list cannot be read, the save is refused
as an outage (503), not as a bad id. The canonical id is stored in `model`,
the catalogue's display name apart in `modelLabel`. The Model box offers the
provider's tool-capable ids (native `<datalist>`) and the card shows
`label · id`. Test connection on OpenRouter now reports key, then model, then
a tool-calling round with the assistant's real declarations — each with its
own wording.

**Why.** Production, 2026-11-04: a workspace saved `Google Gemini` as its
OpenRouter model id. Every ONE AI question failed with OpenRouter 400 "Google
Gemini is not a valid model ID" (ref `0631cda5`) while the card read Connected,
because the OpenRouter check only asked `/api/v1/key` whether the key was live.
Unrelated to the Google empty-tool-schema fix (#248), which is on the Google
path only.

**Where**

- `apps/web/src/lib/ai/catalogue.ts` — `modelCatalogue`, `checkModel`
  (`unknown` / `no-tools` / `unavailable`), `describeCheck`.
- `apps/web/src/app/api/v1/integrations/[provider]/route.ts` — the check, on
  any gemini save touching model, provider or key; independent of
  `skipVerification`.
- `apps/web/src/app/api/v1/integrations/[provider]/models/route.ts` — the list
  the Model box offers; the stored key is used, never returned.
- `apps/web/src/lib/integrations/verify.ts` — OpenRouter: model + tool round;
  Google: a configured id the key cannot use is named as such.
- `apps/web/src/components/workspace/IntegrationBoard.tsx` — datalist, label · id.

**Verified.** `tests/unit/ai-catalogue.spec.ts` (display name, unknown id,
no-tools, valid id with label, outage) and five new cases in
`tests/sales/gemini-connection-save.spec.ts` ("Google Gemini", unknown id,
outage, valid id with blank-box key preserved, workspace isolation). The five
fail against the previous route. Full unit suite: 5063 passed; the only other
failures were packages missing from this host's stale `node_modules`.

**Left open.** Not exercised against openrouter.ai from the test suite (local
catalogue server). Catalogue is read on every save that touches the model.
