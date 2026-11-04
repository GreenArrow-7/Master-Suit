# ONE AI says why it failed, instead of "temporarily unavailable"

**What.** The assistant classifies the failure it caught and shows the cause,
with a short reference that matches the server log line. A refusal from the API
kernel — no Sales entitlement, the rate limit, a role without VIEW on leads —
is read out of its problem+json instead of being discarded.

**Why.** The owner reported ONE AI answering "Show my overdue follow-ups" with
"AI Assistant is temporarily unavailable." That sentence was every outcome: a
monthly budget ceiling, a key the provider rejected, a model id Google has
retired, a timeout, a 403 on the route itself. Nothing in the UI distinguished
a misconfiguration anyone could fix from an outage nobody could, and nothing
tied the message to the log line that held the real status. The feature could
not be diagnosed from the only place it was failing.

**Where**

- `apps/web/src/lib/ai/assistant/service.ts` — `assistantFailure`, and the
  catch that now logs `{status, ref, tenantId}` and emits `ref` to the client.
- `apps/web/src/components/assistant/AssistantWidget.tsx` — a non-OK response
  renders its problem+json `detail` and `requestId`; it used to throw the bare
  status into the generic handler.

**Behaviour.** The same failures now read: "This workspace has used its monthly
AI allowance (…)", "The AI provider rejected the connected key. Check it in
Settings → Integrations → Intelligence.", "The AI provider does not know the
configured model…", "…did not answer in time." Each carries `(ref 1a2b3c4d)`,
which is in the server log. The generic sentence remains only for a cause that
identifies itself as nothing.

**Verified.** `tests/unit/assistant-failure.spec.ts`, 7 cases, all failing on
the old code because it returned one string: budget text passes through,
401/404/400/5xx/timeout are named apart, and a provider body quoting an API key
never reaches the message. `tsc` clean.

**Left open.** This makes the production failure legible; it does not name it.
The cause is read off the next live attempt.
