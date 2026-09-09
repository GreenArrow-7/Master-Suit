# SPEC-0002 — Clarifications

## Status summary

| ID | Question | Status | Affected requirements |
|---|---|---|---|
| `CL-001` | Does separate-session review create genuine independence | `INCORPORATED` | `SEC-005` |
| `CL-002` | How strictly is task scope matched | `INCORPORATED` | `FR-004` |
| `CL-003` | What happens when the repository drifts mid-session | `INCORPORATED` | `FR-006` |
| `CL-004` | May agent tooling repair a governance artefact | `INCORPORATED` | `FR-001` |
| `CL-005` | May B3 extend the CI workflow | `INCORPORATED` | scope |

No material clarification is `OPEN`.

---

## CL-001

**Question:** When the same AI product runs an implementation session and then
a review session, does the review count as independent?

**Why it matters:** If we answer yes without qualification, the whole
separation-of-duty control is theatre, and a reviewer reading a green result
will believe something that is not true.

**Possible interpretations:**
1. Yes — a fresh session has no memory of the implementation reasoning.
2. No — the same model with the same priors is not an independent party.
3. Partially — better than self-review, weaker than a second human.

**Recommended interpretation:** 3, stated explicitly wherever it appears.

**Decision:** A separate session is required where separation applies, and the
tooling enforces that the reviewing actor is not the executing actor. But
every document that mentions it must also state that this improves
independence without creating organisational independence equivalent to a
second human reviewer. Correlated blind spots survive a session boundary.
The control is real; the claim must not exceed it.

**Decision owner:** Application Security

**Status:** `INCORPORATED`

**Affected requirements:** `SEC-005`, and `docs/sdd/AGENT_ROLE_MODEL.md`.

---

## CL-002

**Question:** Does a task declare exact file paths, directory prefixes, or
patterns?

**Why it matters:** Too strict and every real task fails on a file it could
not have predicted. Too loose and scope enforcement means nothing.

**Decision:** Exact paths and directory prefixes only. No globs, no regular
expressions, because a pattern is easy to write so broadly that it authorises
everything. A prefix must end in `/` and is matched after normalising
separators and resolving the path; a prefix that resolves outside the
repository is rejected. Comparison is case-sensitive by default, with a
case-insensitive collision check so a Windows-only match cannot slip through
as a difference between platforms.

**Decision owner:** Solution Architect

**Status:** `INCORPORATED`

**Affected requirements:** `FR-004`, `FR-005`, `NFR-002`.

---

## CL-003

**Question:** A session starts from a commit. What happens when the working
tree changes underneath it?

**Why it matters:** This repository has 36 uncommitted application files in
the tree right now. An agent that "resolves" drift by overwriting would
destroy a colleague's work.

**Decision:** Detect and report, never resolve. Drift is not automatically an
error: legitimate concurrent work is expected. The session records the
starting commit and a snapshot of changed paths; a later check reports files
that changed outside the session's own declared scope as requiring review.
The result is `BLOCKED` or review-required, never a silent overwrite and never
an automatic revert.

**Decision owner:** Solution Architect

**Status:** `INCORPORATED`

**Affected requirements:** `FR-006`.

---

## CL-004

**Question:** When preflight fails because a governance artefact is missing or
malformed, may the tooling fix it?

**Why it matters:** An "auto-fix SDD" feature would let an agent generate the
approval, requirement or scope declaration that was blocking it. The control
would then be self-service.

**Decision:** No, categorically. The tooling reports; it never writes to
`spec.md`, `sdd.json` approvals, risk, lifecycle, threat decisions or
acceptance criteria. `agent create-session` writes only a session record, and
only when preflight passes. There is no repair command and none will be added.

**Decision owner:** Application Security

**Status:** `INCORPORATED`

**Affected requirements:** `FR-001`, `FR-003`, `DATA-001`.

---

## CL-005

**Question:** May Phase B3 extend `.github/workflows/sdd-validate.yml` so CI
runs the agent tests?

**Why it matters:** Without it, the new tests never run in CI, which is a real
gap. With it, B3 makes an R5 infrastructure change it may not be authorised
for.

**Decision:** No. `.github/workflows/*` is R5, and the Phase B3 authorisation
states explicitly that it does not constitute DevOps infrastructure approval.
The one-line change needed is written out in the evidence package as a ready
proposal, the gate is named, and the work stops there. The agent tests live in
their own file so the change stays a single line when someone is authorised to
make it.

Note the contrast with `SPEC-0001/CHG-001`: there, the requester issued an
explicit written instruction to add the workflow if safe, which satisfied the
gate for that bounded change. No equivalent instruction exists here, and the
B3 brief withholds infrastructure approval by name. The same gate therefore
resolves differently, which is the process working rather than an
inconsistency.

**Decision owner:** DevOps / Production Engineering — deferred; the gate is
named and left open.

**Status:** `INCORPORATED`

**Affected requirements:** scope, and `docs/evidence/phase-b3-agent-integration/ci-integration-audit.md`.

---

## Checklist used

- [x] Actors — six agent roles plus the human
- [x] Permissions — what each role may and may not do
- [x] Tenant boundary — not applicable, no tenant data
- [x] Failure behaviour — exit codes, STOP protocol
- [x] Lifecycle — which states permit which role
- [x] Data ownership — records belong to the owning specification
- [x] Concurrency — repository drift (`CL-003`)
- [x] Retry and idempotency — commands are read-only and repeatable
- [x] Deletion and retention — records are permanent artefacts
- [x] Audit — the session record is the audit trail
- [x] External dependency failure — git absent is reported, not guessed
- [x] Security boundary — untrusted records, path containment, actor type
- [x] Backward compatibility — B2 rules and identifiers unchanged
- [x] Migration behaviour — not applicable
- [x] Performance expectations — measured, no invented threshold
- [x] Operational implications — CI deferred (`CL-005`)
