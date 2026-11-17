# The acceptance report counts its own scenarios, and says what each PASS rests on

**What.** Section E totalled 82 against a report defining 85 scenarios. It now
reconciles: 85 IDs, 88 checks, the two scenarios holding two outcomes split,
the raw suite line preserved beside the executable-cases line, and a table of
what class of evidence each PASS stands on.

**Why.** The totals did not count the report they summarised, so a reader could
not tell which scenarios were covered. Worse, the AI rows read as a verified
integration: AI-01, AI-04, AI-07 and AI-08 passed against
`fake-ai-provider.mjs`, which replies 200 to anything and never validates
`tools[].functionDeclarations` — while Google was refusing the very payload
those rows exercised, on every question, in production. A stand-in that cannot
fail the way the vendor does cannot be evidence that the vendor accepts us.

**Where**

- `docs/qa/END-TO-END-ACCEPTANCE.md` — section E rewritten; D-3 added to the
  defect register; `SUITE` no longer reads as an independent or security
  review; section G corrected where it called ONE AI's product side verified;
  G3.5 added with the one command that decides the production cause.

**Behaviour.** Documentation only. No code, no test, no configuration.

**Verified.** The 85 IDs were counted from the document itself — section C's
definitions and section D's results reconcile exactly, with no ID defined
without a result, none duplicated, and none recorded without a definition.
Prettier clean.

**Left open.** The production cause is undetermined until the 400 body behind
`ref 0631cda5` is read: D-3 and an unauthorized key produce the same status,
and before #248 the same sentence on screen.
