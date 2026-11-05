# "Show my overdue follow-ups" is answered through the live model path, from the asker's own records

**What.** A browser spec asks the reported question as a signed-in sales agent,
through the live tool-calling path — the workspace's own encrypted key, the
budget assertion, the model turn, `executeTool` under the caller's permissions
— and asserts which records reached the model. A local provider stand-in plays
the vendor.

**Why.** Everything proving the ONE AI fix so far was either a unit assertion
about a classifier or a tenant assertion about credential resolution. Neither
answers the question the report actually raised: does a real agent asking a
real question get a real, correctly scoped answer. Template mode had been the
only path exercised end to end, and template mode is exactly what runs when the
live path is broken — so a green suite could not tell the two apart.

The stand-in makes the vendor the only simulated part.
`lib/ai/provider.ts:133` honours `AI_GOOGLE_BASE_URL` outside production, so
the transport, the credential resolution, the tool loop and the permission
check are the product's own. Round one returns a `functionCall` for
`getFollowUps(overdue)`; round two echoes back the tool payload the server
handed it. The assertion is therefore about the record set the model was
allowed to see, not about a vendor's phrasing — and two agents, each with one
overdue follow-up, must each see their own and never the other's.

**Where**

- `apps/web/tests/e2e/ai-live-answer-acceptance.spec.ts` — the four cases.
- `apps/web/tests/fixtures/fake-ai-provider.mjs` — the stand-in, with a `tools`
  mode for the two-round shape alongside the `bad-key` / `no-model` /
  `mismatch` / `outage` / `hang` modes.

**Behaviour.** No product code changes. The spec skips itself when
`AI_GOOGLE_BASE_URL` is unset, so CI is unaffected.

**Verified.** 4 passed against `next dev` on the released code, with the
stand-in on 8099. The stand-in's log shows the two rounds per agent
(`gemini-2.5-flash`, the model from the workspace connection's metadata), and
the server's own log line reports `toolsUsed: ["getFollowUps"]` per request.
Each agent's answer contained their follow-up title and not the other's.

**Left open.** `next start` forces `NODE_ENV=production`, where the base-URL
override is deliberately ignored, so this spec needs a dev server; a run
against the production build reaches the real vendor instead. That run is
itself informative — Google answered a deliberately invalid key with a 400 and
the classifier reported "the key and the provider do not match" with a
reference — but a genuine successful vendor answer still needs an authorized
credential, which this session does not have and must not ask for. Scenario
AI-06 stays BLOCKED on that.
