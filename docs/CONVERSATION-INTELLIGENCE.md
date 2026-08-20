# Conversation Intelligence

Post-call and batch only. Real-time coaching, meeting bots and live streaming
are explicitly out of scope and nothing here stubs them.

Most of the pipeline already existed before this module: Recording, Transcript,
AIAnalysis, CallAudit, the transcription provider abstraction, the `ai` and
`media` queues, and consent enforcement all shipped with the engagement work.
What this adds is the layer around it:

| Feature | Where |
|---|---|
| Recording upload (audio/video → MinIO) | `PUT /api/v1/calls/:id/recording/media` — multipart, consent-gated, virus-scanned, queues transcription |
| Transcript paste/upload | existing `POST /api/v1/calls/:id/transcript` (unchanged) |
| Speaker diarisation | `Transcript.segments`; extracted from Google/Deepgram word tags, mock provider emits a diarised two-party call |
| Talk-to-listen ratio | `AIAnalysis.talkRatio` — **measured** from the transcript (`src/lib/ai/callMetrics.ts`), never asked of the model |
| Action items, prompt version | `AIAnalysis.actionItems`, `AIAnalysis.promptVersion` (`ANALYSIS_PROMPT_VERSION` in `src/lib/ai/analysis.ts` — bump on prompt change) |
| Objection playbook CRUD | `Objection` model, `/api/v1/objections`, `/sales/playbook` |
| Playbook matching + addressed check | `ObjectionMatch`, written during analysis by `matchPlaybook` — deterministic phrase matching, works with no model key |
| Follow-up email draft → edit → send | `POST`/`PUT /api/v1/calls/:id/follow-up-email`; sends via the mailer, logs Communication + Activity. Recipient is server-resolved from the call, never client-supplied |
| Roleplay practice | `PracticeSession`/`PracticeScore`, `/api/v1/practice`, `/sales/practice`; scoring runs on the `ai` queue (`practice-score` job) |
| Per-tenant practice cap | `OrganizationSetting.practiceDailyCap` (default 10, 0 = off) |
| Manager coaching notes | `CoachingNote`, `/api/v1/calls/:id/coaching`; self-coaching refused, resolution by rep or author |
| Coaching dashboard + analytics | `/sales/coaching`, `/api/v1/coaching` — `src/services/shared/coachingInsights.ts` |

## Design decisions worth knowing

- **Measured vs inferred.** Talk ratio and playbook matches are computed in
  plain code (`callMetrics.ts`). A model returns a plausible number for both,
  and a manager cannot tell a guess from a measurement after the fact.
- **Every AI path has a labelled fallback.** No Gemini key → analysis is
  `demo-simulation`, follow-up drafts say `template`, the practice prospect
  says `simulated`. Nothing fake can be mistaken for a model verdict, and the
  whole module runs end to end on a fresh clone with nothing configured.
- **Drafts are not stored.** A follow-up email exists in the composer until it
  is sent; the sent copy is a `Communication` row where retention already
  applies.
- **`addressed` is a heuristic** (bag-of-words overlap between the rep's later
  lines and the playbook's recommended responses) and the UI says so. Upgrade
  path: one extra field on the existing analysis model call.
- **Diarisation speaker mapping** assumes first-speaker-is-the-rep on outbound
  calls (`segmentsToTranscript`). Honest fix when disputed: channel-separated
  recording from the telephony vendor.
- **The claim lives in one place.** Found while verifying: the analysis and
  audit routes each set their row to PROCESSING *before* enqueueing, and the
  worker's own claim then saw PROCESSING and skipped the work it was queued
  for — so every manual re-run stranded the row in PROCESSING forever. The
  routes no longer claim; `claimAnalysis`/`runCallAudit` do, and a PROCESSING
  row older than `ANALYSIS_STALE_MS` (15 min) is reclaimable so a dead process
  cannot make a call permanently un-analysable. Regression test:
  "re-running analysis actually re-runs" in the flow spec.

## Coaching dashboard: what the screen is for

The list defaults to **analysed calls only** (`?show=all` for the rest). A
workspace's completed-call log is mostly calls nobody uploaded a recording for;
listing those buried the handful of coachable calls under fifty rows of
em-dashes, so a screen headed "analysed calls" was really a call log. The
awaiting-analysis backlog is one click away and its count is always shown.

The Score column is the **audit score and nothing else**. It used to fall back
to the *analysis* status, so a call with a finished analysis and no scorecard
rendered the word "completed" under a column headed Score — a state reading as
a result. The state now shows as a quiet "analysing…" or "failed", never a
value that looks like a grade.

Layout rules worth keeping (all cost a bug once):

- `lf-grid` cells are `white-space: nowrap` and `lf-grid-wrap` is
  `overflow: hidden`. A bare `<table class="lf-grid">` inside a card therefore
  **clips** its last column rather than scrolling. Always wrap, and add
  `overflowX: 'auto'` for tables wider than a card.
- Every `<td>` needs `data-label`. Below 860px the design system turns rows into
  cards and renders that attribute as the field name; without it a phone shows
  bare unlabelled values.
- `lf-stat-strip` draws **white** dividers for dark hero bands. Inside a light
  card use `lf-stat-strip lf-stat-strip--light`.
- Panels in an analytics row need `alignItems: 'start'`, or a sparse panel
  stretches to the tallest sibling and renders as a heading over 200px of void.

## Security

- All five new tables (`Objection`, `ObjectionMatch`, `PracticeSession`,
  `PracticeScore`, `CoachingNote`) are tenant-scoped with FORCE RLS, the same
  policy shape as the rest of the schema. Migration:
  `20260819100000_conversation_intelligence`.
- Every route goes through the API kernel (`calls` module permissions). The
  multipart upload reproduces the kernel's order by hand, like the document
  uploads. Coaching visibility rides `resolveOwnerIds`, the same helper the
  lead lists use — OWN sees self, TEAM+ sees their subtree.
- Consent is enforced before a recording is stored, before transcription, and
  on every playback — unchanged from the existing pipeline.

## Tests

- `tests/unit/call-metrics.spec.ts` — ratio + matching edge cases
- `tests/tenant/conversation-intelligence.spec.ts` — cross-tenant denial by exact id
- `tests/permission/conversation-intelligence.spec.ts` — no-grant 403s, OWN-scope coaching refusal, self-coaching refusal
- `tests/integration/conversation-intelligence-flow.spec.ts` — the full chain:
  consent → upload → transcribe (mock, diarised) → analyse (simulated) →
  playbook match → talk ratio → draft → send → dashboard; and practice → score
  → daily cap. Object storage is mocked at the module seam (CI runs no MinIO).

## Rollout

1. `npx prisma migrate deploy` — additive only: five new tables, four new
   columns with defaults, two enums. No rewrite of existing rows, no downtime.
2. Restart the worker (`npm run worker`) so the `ai` queue picks up the new
   `practice-score` job name. Old jobs are unaffected.
3. No new environment variables. Tenants that want real transcription/analysis
   connect providers under Settings → Integrations as before; everything
   degrades to labelled simulation without them.
4. Rollback: revert the deploy. The new tables are ignored by old code; the new
   `AIAnalysis` columns have defaults, so old workers keep writing rows
   happily. Nothing needs to be dropped to go back.
