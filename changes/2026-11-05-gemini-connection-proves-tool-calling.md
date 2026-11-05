# "Connected" means ONE AI's own request was accepted, not that a key is live

**What.** Testing a Gemini connection now sends the assistant's sixteen real
tool declarations to the configured model, after listing models. The card says
"Tool calling verified on `<model>`", or refuses the connection and says the
key is fine but the declarations were not.

**Why.** ONE AI was refused on every question in production while this card
read Connected. The check listed models — `GET /v1beta/models?key=…` — which
sends no tools, so the one request the feature actually makes was never tried
by the thing that reports on it. A health check that exercises a different
request than its feature cannot fail when the feature does, and this one
didn't for as long as the feature has existed.

**Where**

- `apps/web/src/lib/integrations/verify.ts` — the `gemini` branch: after the
  model list, one `generateWithTools` round against `c.model || chosen` with
  `TOOLS`, `maxOutputTokens: 16`. The tool layer is imported dynamically, since
  nothing else in the file needs the CRM services. A rejection is reported as
  its own cause, through `redactSecrets` like every other vendor body here.
- `apps/web/tests/unit/ai-provider-label.spec.ts` — both outcomes.

**Behaviour.** A connection whose key works and whose model accepts the
declarations reads `N models available, e.g. gemini-flash-latest. Tool calling
verified on gemini-flash-latest.` One whose model refuses them goes to ERROR
with "The key works, but `<model>` refused the assistant's tool declarations —
`<vendor's own words>`", which is deliberately not the wording for a bad key:
re-issuing the key fixes nothing here. Costs one 16-token generation per test,
on a route already rate-limited to 30 per 5 minutes.

**Verified.** `tests/unit/ai-provider-label.spec.ts` 7/7, the two new cases
driving a stubbed Google that lists models and then accepts or refuses the tool
payload, including that the key never appears in the message. The OpenRouter
branch is untouched and its cases still pass. `tsc` clean.

**Left open.** The probe is a real request to Google from the deployment, but
it has not been made against Google from here — this environment has no
credential and denies egress to the vendor. First proof is the owner pressing
Test connection in production.
