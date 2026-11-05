# Every ONE AI question failed, because one tool takes no arguments

**What.** A tool declared with no parameters is sent to Google without a
`parameters` key, instead of with an empty OBJECT schema that Google refuses.

**Why.** The owner's ONE AI answered "Show my overdue follow-ups" with "The AI
provider refused the request… (ref 0631cda5)" — the 400 branch of
`assistantFailure`. The question was never the problem. `getMyDay` takes no
arguments and was declared `{ type: 'object', properties: {} }`, which OpenAI's
schema accepts and Google's rejects:

```
GenerateContentRequest.tools[0].function_declarations[13].parameters.properties:
should be non-empty for OBJECT type
```

Google validates the whole request before running any of it, so one malformed
declaration out of sixteen failed every assistant request, on every question,
in every workspace on a `google` credential — a total outage of the feature.

It survived every check because of where the two healthy paths look. **Test
connection** calls `GET /v1beta/models?key=…` (`lib/integrations/verify.ts:155`)
— a model listing that sends no tools, so it is green while the assistant is
dead. And `tests/unit/ai-provider.spec.ts` drives a fake provider that returned
200 to anything, with every tool in its own fixture declared
`properties: {}` — the exact shape the real API rejects.

**Where**

- `apps/web/src/lib/ai/provider.ts` — `generateWithTools`, Google branch:
  `parameters` is omitted when the schema carries no properties. In the
  translation, not in the tool, so a tool added tomorrow cannot reintroduce it.
  The OpenRouter branch is untouched; its schema accepts the empty object.
- `apps/web/tests/unit/ai-provider.spec.ts` — the fake provider now performs
  Google's own validation of `functionDeclarations` and returns that 400.

**Behaviour.** `getMyDay` is still declared and still callable; only the empty
`parameters` key is gone. Nothing else changes: same endpoint, same stored
credential, same model id, same budgets, no vendor switch, no simulation mode.

**Verified.** `tests/unit/ai-provider.spec.ts` 16/16. The new case fails on the
old code with the production error verbatim — `AI provider error 400 — {"error":
{"code":400,"status":"INVALID_ARGUMENT","message":"Invalid JSON payload
received. GenerateContentRequest.tools[0].function_declarations[1].parameters.
properties: should be non-empty for OBJECT type"}}`. AI unit suites 41/41,
`tests/ai` and the Gemini tenant suite 39/39, `tsc` clean, Prettier clean.

**Left open.** Not yet confirmed against Google itself: this environment has no
provider credential and denies egress to the vendor, so the rejection is
reproduced against Google's documented rule, not against Google. Production is
the proof, and the 400 body in the log line for ref `0631cda5` is what tells
the owner whether this was the only cause — Google also returns 400 for an
invalid API key, with a different message.
