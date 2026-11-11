# The call-intelligence test matched a playbook that did not exist yet

## What

`tests/integration/conversation-intelligence-flow.spec.ts` asserted that a call
carries one objection match, and failed in CI on 11 November with zero. It had
passed on the same code minutes earlier and passed locally nine times out of
nine, which is the signature of a race rather than a defect.

The test now re-runs `matchPlaybook` after creating the objection, and says why.

## Why

`matchPlaybook` reads the playbook **as it is now** — that is its whole design,
so that a retired or renamed entry stops matching. The test's ordering defeats
it:

1. The recording-upload route "may have already run the chain inline (dev mode)"
   — the spec's own comment, two tests earlier. That chain includes the
   analysis, and therefore the playbook match.
2. The objection is created **after** that, in a later test.
3. So the inline run saw `playbook.length === 0`, returned 0 and wrote nothing.
4. The explicit `analyseCall` then loses the claim on an already-COMPLETED row
   and is swallowed by its own `.catch(() => {})`.
5. `settles()` waits for the **analysis row**, which is already there, and
   returns immediately.
6. Nothing ever matched the objection. `objectionMatch.findMany` → `[]`.

When the inline chain happens to finish _after_ the objection is created, the
test passes. Nothing about the application changes between the two outcomes.

The deeper fault is that the test waited on one artifact and asserted on
another written later by a different code path. Re-running the match is
deterministic and does not weaken what is under test: the real function still
runs against the real transcript and the real playbook, and the assertions on
the analysis row are untouched.

Delete-then-insert plus the unique key on (tenant, call, objection, phrase) make
the re-run safe whoever else has run it — the function's own comment says so.

## Where

- `apps/web/tests/integration/conversation-intelligence-flow.spec.ts` — the
  re-run, and the comment recording which run saw an empty playbook and why.

## Behaviour

No change to the application.

## Verified

Three consecutive runs, **9 passed** each. The failure it fixes was in CI at
`4a4e03e2`; the file is untouched by every other change on this branch and
creates no leads, so the contact rule is not implicated.

## Left open

Two tests earlier, `transcribeCall` carries the same shape — a `.catch(() => {})`
around work that may already have run inline. It asserts only on the transcript
row, which that chain writes, so it is not currently racing. It would start to
if anything downstream of the transcript were asserted there.
