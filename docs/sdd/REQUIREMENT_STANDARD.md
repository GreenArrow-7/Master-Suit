# Requirement Standard

`NORMATIVE — engineering process requirement.`

## What a requirement must be

| Property | Meaning | Failure looks like |
|---|---|---|
| Atomic | One obligation per identifier | "Validate input and log the attempt and rate-limit the caller" |
| Testable | A test can pass or fail against it | "Handle errors gracefully" |
| Unambiguous | One reading survives a hostile reader | "Admins can manage users" — which admins, which users, which verbs |
| Necessary | Traces to the problem the spec states | A requirement nobody asked for |
| Implementation-neutral | Says what, not how, unless the how is genuinely mandatory | "Store the flag in Redis" when any durable store would do |
| Uniquely identified | Carries a permanent id | Prose paragraphs with no id |
| Traceable | Reachable from plan, task, test and result | A requirement no test mentions |
| Measurable where relevant | Numbers where numbers decide pass or fail | "Fast", "scalable", "secure" |

## Examples

Poor: "Make authentication secure."
Better: `SEC-003 — An expired authenticated session must be rejected by every
protected API endpoint, with no partial data returned.`

Poor: "The API should be fast."
Better: `NFR-004 — Under the reference workload defined in CL-002, the lead
list endpoint must return within the latency threshold approved in CL-002.`

Note what the second example does: it does **not** invent a millisecond
figure. A threshold that product and engineering have not agreed is not a
requirement, it is a guess wearing a number. Raise a clarification and let the
decision owner set it. The same applies to retention periods, page sizes,
rate limits, lockout counts and timeout values.

## Requirement categories

- `FR-` functional: observable behaviour of the system.
- `NFR-` non-functional: performance, availability, capacity, usability,
  accessibility, compatibility.
- `SEC-` security: authentication, authorization, tenant isolation, secrets,
  input handling, audit, abuse resistance.
- `DATA-` data and privacy: what is stored, for how long, who may read it,
  what deletion means, what leaves the system.
- `OBS-` observability: what must be visible when this runs and when it fails.
- `AC-` acceptance criteria: the conditions under which a human agrees the
  work is done. Each acceptance criterion cites the requirements it covers.

In this brownfield system, three categories deserve deliberate attention on
almost every change, because they are where the product's guarantees live:
tenant isolation, permission scope, and audit. If a specification touches data
that belongs to a workspace, it states the tenant-isolation obligation
explicitly rather than assuming the platform handles it.

## Mandatory specification sections

Required content, in this order. Sections that do not apply are kept with the
words "Not applicable" and a reason, never deleted, so a reader can tell the
difference between "considered and irrelevant" and "forgotten".

1. Metadata
2. Problem
3. Goal
4. Background and context
5. Scope
6. Out of scope
7. Actors
8. User stories, where applicable
9. Functional requirements
10. Non-functional requirements
11. Security requirements
12. Data and privacy requirements
13. Observability requirements
14. Failure behaviour
15. Edge cases
16. Acceptance criteria
17. Dependencies
18. Assumptions
19. Open questions
20. Risks
21. Rollback and reversibility expectations, where applicable
22. Implementation constraints, only where genuinely mandatory
23. Evidence and existing-system references
24. Revision history
25. Approval

Depth scales with risk. At R2 several sections are a line each. At R4 and R5
they are not.

## Writing rules

1. Use "must" for obligations. Avoid "should" in a requirement; if it is
   optional, it is not a requirement.
2. State the actor. "The system must" hides which component and which caller.
3. State the failure side. A requirement that only describes success leaves
   the error path to whoever writes the code.
4. Do not bury a second requirement in a subordinate clause.
5. Do not name files, functions or libraries in a requirement unless the
   choice is itself the requirement. Those belong in the plan.
6. Do not restate platform guarantees as if new. Cite the existing control
   (`docs/security/AUTHORIZATION.md`, `docs/architecture/DATABASE.md`) and
   state only what this change adds.
7. Mark anything you could not establish as an open question rather than
   asserting it. The evidence standard applies inside specifications too.

## Brownfield rule

Before writing a requirement about behaviour that already exists, read the
current implementation and cite it in the Evidence section. Record whether the
requirement **preserves**, **changes** or **replaces** that behaviour. A
specification that silently redefines existing behaviour is the most expensive
kind of defect in a production system, because nothing about it looks wrong.

## Authority / References

- `AGENTS.md` §1, §3, §5
- `docs/RISK_CLASSIFICATION.md`
- `docs/sdd/IDENTIFIER_STANDARD.md`, `docs/sdd/CLARIFICATION_STANDARD.md`
- `docs/security/AUTHORIZATION.md`, `docs/security/SECURITY_MODEL.md`,
  `docs/architecture/DATABASE.md` — existing guarantees to cite rather than
  restate
- Phase A evidence standard, `docs/evidence/phase-a-foundation/evidence-audit.md`
