# AI evaluation — golden sets, acceptance, and what runs where

Every AI feature that reaches a seller or a manager is measured against a fixed set
of scenarios before its prompt, rules or model change ships. The sets live under
`tests/ai/golden/`; each scenario names the input and what a competent sales lead
would expect back.

## Two layers, two runners

| Layer         | What it exercises                                                                                                                                | Runner                        | When                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| Deterministic | Stage rules, heuristic hints, requirement extraction — the code that answers when no model does, and the floor every model answer is compared to | `tests/ai/*.spec.ts` (vitest) | Every CI run                                                      |
| Model         | The same scenarios through the live model (`coachTick`, `analyzeTranscript`) with the workspace's real prompt                                    | `npx tsx scripts/ai-eval.ts`  | Before a prompt or model change is merged; needs `GEMINI_API_KEY` |

The deterministic layer is the regression gate: a rule change that breaks a
known scenario fails CI. The model layer is a report: it prints stage agreement,
hint-kind coverage, groundedness violations (a hint naming a property, price or
plan not in the CRM context) and token cost per scenario, and exits non-zero
below the acceptance floors.

## Acceptance floors

| Feature       | Metric                                                      | Floor                                                        |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Live coach    | Sales stage agreement with the golden label                 | 90%                                                          |
| Live coach    | Expected hint kinds present                                 | 100% of scenarios that name one                              |
| Live coach    | Groundedness: hints reference only CRM-context inventory    | 0 violations                                                 |
| Live coach    | Hints per tick                                              | ≤ 2, each with `text`; `say` ≤ 1 sentence                    |
| Call analysis | Sentiment label agreement                                   | 80%                                                          |
| Call analysis | Every objection in the golden label appears in `objections` | 90%                                                          |
| Any           | Output validates against the feature's JSON schema          | 100% (a parse failure is a failure, never a silent fallback) |

## Adding a scenario

Append to the feature's JSON with an `id` nobody will reuse, the transcript window
as a seller would hear it, the expected stage/labels, and any `mustNotMention`
terms (used by the groundedness check). Real calls are anonymised first: names,
numbers and unit identifiers replaced, never removed.

## What the framework does not do

It does not grade prose quality by asking a second model; every check is a label
or a rule a person could apply. It does not run the model layer in CI — that would
spend tokens on every push and tie the build to a provider's availability.
