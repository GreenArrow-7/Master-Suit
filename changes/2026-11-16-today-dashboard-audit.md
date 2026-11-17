# The product audit, and a proposal for a "Today" workspace

## What

`docs/product/AUDIT-AND-TODAY-DASHBOARD.md` — a module-by-module audit, a
verdict on live call coaching, a per-role Today dashboard design, the
lead-to-close AI workflow, a feature-cleanup list and a phased plan. Documents
only; no code changed.

## Why

The owner asked for an audit before any redesign: every employee should open
the product and see their status, what needs them first and why, what to do
next, and how to improve.

## Where

- `docs/product/AUDIT-AND-TODAY-DASHBOARD.md` — the whole deliverable.

## Behaviour

Nothing changes for users.

## The one finding that matters

**Live call coaching is built three ways and proven none.** Transports:
`demo-simulation` (a scripted call, coached for real — and the default, since
`LiveCallWorkspace.tsx:106` opens in `mode: 'sim'`), `live-mic` (browser
microphone in ~5s chunks through batch STT), and `vendor-stream`
(`src/workers/liveStream.ts`: a real WebSocket server with per-call token auth,
per-track streaming STT, Redis pub/sub to the SSE, and model coach ticks,
started at `src/workers/index.ts:89-90`). The vendor path is gated at
`dial/route.ts:85` on `LIVE_STREAM_WS_URL`, a provider advertising
`LIVE_STREAM`, and recorded consent.

So a demo looks like a working call. `changes/PROJECT.md:457` and
`docs/qa/05c-sales.md:637` both already say the credentials and one real round
trip are outstanding; this document says it in one place and names the
evidence that would settle it.

The smallest next step costs nothing and blocks nothing: find out whether iOS
gives a web view the microphone during a cellular call. If it does not,
`live-mic` is desk-only and the vendor stream is the only route to coaching on
a phone.

`docs/CONVERSATION-INTELLIGENCE.md:3` is now wrong — it says real-time coaching
is out of scope and nothing stubs it. The live path was built after it.

## Verified

Nothing was run. No screen was opened, no call was placed, no production data
was read. Claims are labelled **code** (read this session, cited by file and
line), **documented** (asserted by a project document) or **unverified**.

## Left open

- No screen-level pass, on either desktop or mobile, with any role.
- No usage data exists, so every classification in the cleanup list is a
  hypothesis. A 30-day `AuditLog` query by `objectType` would turn them into
  decisions.
- `docs/MOBILE_UI_AUDIT.md` was not read.
- `graphify-out/` is absent from this worktree, so the Graphify map was not an
  input.
- `docs/CONVERSATION-INTELLIGENCE.md` needs correcting.
