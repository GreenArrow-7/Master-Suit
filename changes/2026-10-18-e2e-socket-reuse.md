# Browser tests no longer fail on a connection the dev server already closed

**What** — The E2E suite sends every `page.request` call on a fresh connection
instead of reusing a pooled one (`apps/web/playwright.config.ts`).

**Why** — Three CI runs failed on a test's first `page.request` call with
`read ECONNRESET` or `socket hang up` (main da5b422d, #217's batch round3-b,
#218), each costing a re-run. The server log shows the request never arrived.
Playwright keeps one keep-alive pool per worker, so that call reused the socket
the previous test had left idle (6.7 s on da5b422d). `next dev` closes idle
sockets after 5 s and has no flag to change it (`next start` has
`--keepAliveTimeout`, but E2E needs dev mode for the mock outbox, telephony and
transcription). When the worker was busy, the close went unread and the request
was written to a dead socket. Chromium retries this case; Node does not, so only
API calls from the specs failed.

**Where**
- `apps/web/playwright.config.ts` — `Agent.prototype.keepSocketAlive = () => false`, loaded by every worker.

**Behaviour** — None for users. CI's E2E step stops failing on this reset.

**Verified**
- A local repro (a Node server with the 5 s timeout, Playwright's request API,
  gaps of 1–7 s with the worker blocked for 0.7 s): stock 1.62 failed 2 of 9 with
  `apiRequestContext.post: read ECONNRESET` over 4 reused connections; with the
  line, 0 of 9 over 18 fresh connections.
- A throwaway config plus spec: with the line, a worker's three requests open
  three connections; without it, one.
- CI's full E2E run on this branch.

**Left open** — None.
