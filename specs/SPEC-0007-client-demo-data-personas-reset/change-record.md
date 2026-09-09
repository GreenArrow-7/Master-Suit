# SPEC-0007 — Change record

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

Changes after the gate-1 approval of 2026-09-08. Historical approved intent is
preserved; nothing here rewrites what was approved.

---

## CHG-001 — The workspace already holds 40 employee profiles, not 24 to 30

**Type:** `REQUIREMENT CHANGE`
**Status:** `PREPARED — awaiting the original specification approver`
**Raised:** 2026-09-08, by the IMPLEMENTER session `ASES-0001`, before any
generator code was written.
**Approver required:** Product Owner or Solution Architect — the roles that hold
gate 1 at R3, per `docs/sdd/CHANGE_CONTROL.md`. An agent may prepare this record
and may not approve it.

### What was found

`FR-002` states that the demo dataset provides *between 24 and 30* employee
profiles. `UT-001` asserts that range.

The specification was written from the observation that the seed creates
departments, branches and employee profiles without HR records. That observation
was correct. The **volume** was not established at specification time, and it is
larger than assumed: `apps/web/prisma/seed/index.ts` declares 40 user
specifications, and the loop that consumes them upserts an `EmployeeProfile` for
every one unconditionally — there is no branch and no `continue` in that loop
body. The demo workspace therefore already holds **40** employee profiles before
the HR generator runs.

### Why this is a requirement change and not a detail

Two approved requirements now pull in opposite directions:

- The population cap in `FR-002` stops at 30.
- The requirement in `FR-008` is that every HR screen the HR persona reaches
  renders populated data, or an empty state that is correct because the feature
  is deliberately out of scope.

Generating HR records for only 24 to 30 of the 40 would leave 10 to 16 employees
with no attendance and no leave. The employee directory would show 40 people and
the attendance report would cover a subset, which is precisely the "unintended
empty state" `FR-008` and `E2E-005` exist to prevent. Satisfying `FR-002`
literally would breach `FR-008`.

`UT-001` cannot be quietly rewritten to fit, either. Weakening an approved
assertion so that it passes is forbidden outright, and a test that asserts a
range contradicted by the fixture is a defect in the specification rather than
in the code.

### Proposed disposition

Amend `FR-002` to read, in substance: *the demo dataset provides an HR profile —
department, designation and position in the reporting hierarchy — for **every
active employee profile in the demo workspace**, and the workspace holds at
least 24 of them.* Amend `UT-001` to assert that floor and that the HR
attributes cover the full population, rather than an upper bound the workspace
contradicts.

Scope is unchanged in kind and slightly larger in volume: roughly 40 employees
across 30 to 60 working days rather than 30, which is well inside `NFR-004`.

### Alternatives considered and rejected

- **Populate only 30 and accept the gap.** Rejected: it breaches `FR-008` and
  produces exactly the half-empty demonstration this specification exists to
  end.
- **Reduce the Sales seed to 30 users.** Rejected: it would rebuild the Sales
  dataset, which `FR-009` and the approved scope forbid, and would change
  demonstration personas that `docs/DEMO.md` already documents.
- **Reinterpret `FR-002` silently as "the HR cohort".** Rejected: that is a
  silent edit of an approved requirement, which `docs/sdd/CHANGE_CONTROL.md`
  rule 1 forbids.

### What proceeded, and what did not

Implementation continued on every task independent of this record: the HR
configuration data, the reporting hierarchy, leave, attendance, the reset
extension, the reset coverage control, the Sales audit, and the isolation and
security tests. The generator is written to cover **every** active employee
profile it finds, which is the behaviour both dispositions share.

What is **held** pending approval of this record: the numeric assertion in
`UT-001`, and the corresponding wording of `FR-002`. Neither has been edited.

### Approval

| Field | Value |
|---|---|
| Decision | **approved with amendment** |
| Role | Product Owner |
| Actor type | human |
| Date | 2026-09-08 |

**Decision as given.** The hard cap is replaced by an invariant: *every active
synthetic employee profile visible in the demo workspace must have a coherent
HRMS demo dataset.* The current fixture expectation is 40, recorded as an
expectation and explicitly **not** as an architectural maximum. A minimum floor
may be retained for realism. No visible active demo employee may be left
partially populated to satisfy a numeric cap, and `FR-008` must remain
satisfied.

**Applied to.** `FR-002` reworded to the invariant, with a floor of 24 and the
current fixture expectation named. `UT-001` now asserts the invariant and the
floor rather than an upper bound. The original wording is preserved above; it
is not rewritten to look correct in hindsight.

---

## CHG-002 — The demo reset already clears HRMS; the premise of FR-011 is false

**Type:** `REQUIREMENT CHANGE`
**Status:** `PREPARED — awaiting the original specification approver`
**Raised:** 2026-09-08, by the IMPLEMENTER session `ASES-0001`, before the reset
was modified. No reset code was changed.
**Approver required:** Product Owner or Solution Architect.

### What was found

`FR-011` requires the demo reset to remove HRMS tenant-scoped records "in
addition to the records it already removes". `CL-003` records the evidence that
led to it: the reset performs 47 explicit deletions, all CRM, and names no HR
table.

That evidence was incomplete, and the conclusion drawn from it was wrong. The
reset branch does not end at the 47 deletions. Its final statement is
`tenant.delete()`, and a count over the schema shows **187 of the 188 models
carrying a `tenantId` declare `onDelete: Cascade` on their tenant relation**.
The database therefore removes every HR row when the tenant goes. The single
exception is `PlatformAuditEvent`, whose relation is `SetNull` deliberately, so
that an audit trail survives the tenant it describes.

The demo reset already restores a clean HRMS baseline. It has done so since
before this specification was written.

### Why the specification said otherwise

The audit behind `CL-003` stopped reading at the deletion list. The explicit
deletions exist because, as their own comment says, child-first ordering is
needed where foreign keys point at rows the cascade reaches in the wrong order —
not because the cascade is absent. Reading the list and not the statement after
it produced a confident, wrong conclusion, and it is exactly the class of error
`FR-015` exists to catch.

### Proposed disposition

Withdraw `FR-011` as written and replace it with a statement of the behaviour
that actually holds and must keep holding: *the demo reset clears every
tenant-scoped record of the demo workspace, whether by explicit deletion or by
the tenant cascade, with `PlatformAuditEvent` excluded by design.*

`FR-015` is **unaffected and is now the whole of the reset work**. Its wording
already covers this: a model is compliant when it is "cleared by the reset",
and a model cleared by the cascade is cleared by the reset. The coverage check
is strengthened rather than weakened — it must assert cascade-or-explicit-
deletion-or-reviewed-exclusion, which is a stronger property than the one
originally imagined, and it would have caught this error.

`IT-005`, `REG-002` and `UT-007` stand. `TASK-004` reduces to almost nothing:
there is no teardown to add.

### What proceeded, and what did not

No reset code was written or modified. `apps/web/prisma/seed/hr.ts` carries a
comment in place of the teardown list it would otherwise have exported,
explaining why the list does not exist, so that the next person to look does not
repeat the audit and reach the same wrong answer.

Held pending approval: the wording of `FR-011` and the scope of `TASK-004`.

### Approval

| Field | Value |
|---|---|
| Decision | **approved** |
| Role | Product Owner |
| Actor type | human |
| Date | 2026-09-08 |

**Decision as given.** No redundant explicit HR deletion code is to be added.
`FR-011` is amended to express the real requirement: the demo reset must
reliably remove all resettable tenant-scoped demo data through the existing
tenant cascade. The deterministic coverage guard is retained and is the control
that keeps this true. The four fail-closed environment protections must not be
weakened, and `PlatformAuditEvent`'s deliberate `SetNull` behaviour must not be
changed for the convenience of a demo reset.

**Applied to.** `FR-011` reworded. `TASK-004` restated as a verification task
rather than an implementation task — it is recorded as work that was found
unnecessary, not as work that was written and then removed.


---

## CHG-003 — One client-facing login, not three

**Type:** `REQUIREMENT CHANGE`
**Status:** `APPROVED`
**Raised:** 2026-09-08, after convergence, by the requester.
**Approver required:** Product Owner or Solution Architect.

### What changed

The accepted business requirement is **one URL, one login, one password**,
reaching Sales *and* HRMS in the same session. `FR-010` delivered three
personas and the demonstration used all three. That was a faithful reading of
the original brief — the three logins exist to *show* role scope — but it is
not the client experience now required.

### What is already true, and what is not

The architecture already satisfies it. Verified against the seeded workspace:

| Fact | Evidence |
|---|---|
| `admin@example.com` holds `org_admin` | role catalogue |
| Its platform role is `USER` | `PlatformUser.platformRole` — not owner, support or auditor |
| It lives in one workspace, `manath-homes` | `WorkspaceMembership`, status ACTIVE |
| That workspace is entitled to **both** modules | `ModuleEntitlement`: SALES ACTIVE, HRMS ACTIVE |
| That workspace holds **both** datasets | 500 leads · 41 employee profiles · 1800 attendance rows |
| One session reaches both | `E2E-001` already walks dashboard → Sales → HRMS → admin → logout without re-authenticating |
| It is refused the platform control plane | `ST-005`, `E2E-004` |

So no new role, no new workspace and no authorisation change is needed. What is
missing is a **designation**: the specification names three personas without
saying which is the client-facing credential.

### Proposed disposition

Add `FR-017`: exactly one persona is the client-facing demonstration
credential; a single authenticated session of it reaches both modules without
re-authentication or a workspace switch; and it holds no platform role.

`FR-010` is **not withdrawn**. The Sales and HR personas remain as security
fixtures — `ST-003`, `ST-004` and `ST-005` need two differently-scoped
accounts to prove role isolation at all, and deleting them would delete the
evidence. They are explicitly **not** client-facing credentials.

The deployed account's final address is deferred to `SPEC-0008`, because the
demonstration hostname is not yet known and inventing one now would be a name
nobody can honour.

### Why this is a requirement change and not a note

`FR-010` is an approved requirement and `SPEC-0007` has converged. Adding
`FR-017` changes what "done" means, so it goes through change control rather
than being written in quietly. The convergence that already happened is
preserved: this record amends the specification forward, it does not rewrite
history.

### Approval

| Field | Value |
|---|---|
| Decision | **approved** |
| Role | Product Owner |
| Actor type | human |
| Date | 2026-09-09 |

**Decision as given.** One client-facing login reaching Sales and HRMS inside
the same platform and the same session. The Sales and HR personas are retained
as internal security fixtures and are explicitly **not** client credentials. The
safest legitimate tenant-scoped role is to be used; platform superadmin is
forbidden.

**Authority.** `docs/sdd/CHANGE_CONTROL.md` assigns a `REQUIREMENT CHANGE` to
"the original spec approver for that risk level". Gate 1 at R3 is Product Owner
**or** Solution Architect, and this specification's gate 1 was approved by this
same Product Owner. No rule in `AGENTS.md` or the gates standard bars one
person from holding several approver roles; the only separation rule is that an
AI may not review its own work.

Decision supplied explicitly in session by the human requester and transcribed
by an agent. The agent did not make it and does not hold it.


---

## CHG-004 — The client login sits on a real company domain, which `DATA-005` forbids

| Field | Value |
|---|---|
| Type | REQUIREMENT CHANGE |
| Raised | 2026-09-09 |
| Raised by | agent, during implementation of `FR-017` |
| Affects | `DATA-005`, `CL-007`, `FR-017` |
| Status | **APPROVED** — Product Owner, 2026-09-09 |

### What was decided, and what it collides with

The business decision is unambiguous: the single client-facing demonstration
login is `demo@youhan.in`. It was given as authoritative and is not in question
here.

It contradicts an approved requirement. `DATA-005` reads:

> Every generated electronic address sits on a domain reserved for
> demonstration use, so that a misdirected message cannot reach a real mailbox.

`youhan.in` is a real company domain, not a reserved one. `CL-007` had already
been asked this exact question about `manathhomes.ae` and resolved it by
**Option A** — moving every address onto `example.com` (RFC 2606). Ten persona
addresses were changed to satisfy it, and three scripts' defaults with them.
Putting the most visible login of all back onto a live domain reverses that
resolution for one address.

This is recorded rather than absorbed. An agent may not decide that an approved
requirement no longer applies because a later instruction is inconvenient for
it, and the instruction did not mention `DATA-005` — so it cannot be read as a
decision to waive something the decider was not shown.

### Why this is not merely a technicality

`CL-007` recorded the communication risk as close to zero by three independent
mechanisms — the demo environment selects the mock mail provider, the workspace
holds no integration connection, and `ST-008` and `ST-009` assert both. Those
mechanisms are unchanged and still hold.

But `CL-007` also recorded the condition under which a real domain becomes
acceptable, and it is worth quoting against this decision rather than around
it. **Option B** was *"amend `DATA-005` to accept a deterministic non-customer
demonstration domain the organisation controls"*, and it was unavailable for
one stated reason: *"needs the organisation to actually control
`manathhomes.ae` — which has not been established."*

That reason does not apply here. The organisation is Youhan; `youhan.in` is its
own domain, and the decision to use it is the organisation exercising control
over it. So this is `CL-007` Option B becoming available, not `CL-007` being
overruled — which is a materially better position than the one `CL-007`
rejected, and worth saying plainly.

The residual exposure is honest and small: mail to `demo@youhan.in` reaches a
mailbox the organisation owns, rather than being absorbed by a reserved domain
that discards it. That is the difference between a misdirected message landing
somewhere accountable and landing nowhere. `DATA-005` was written to prevent it
landing on a **stranger**, and it cannot do that here.

### Measured evidence about the domain, 2026-09-09

Looked up rather than assumed. Public DNS only; nothing was configured.

| Query | Result |
|---|---|
| `youhan.in` A | **166.117.93.67** — the domain is registered and resolves |
| `youhan.in` nameservers | `ns53.domaincontrol.com`, `dns.jomax.net` — DNS is managed at GoDaddy |
| `youhan.in` MX | **none** — the query returns SOA, so no mail exchanger is published |
| `demo.youhan.in` | **NXDOMAIN** — no record exists |

Two things follow, and they point in opposite directions, so both are stated.

**It strengthens the amendment.** `DATA-005` guards against a misdirected
message reaching a real mailbox. With no MX record on `youhan.in`, there is no
mailbox for `demo@youhan.in` to reach — mail to it is refused at the edge. The
requirement is protecting against a thing that currently cannot happen.

**It is a fact that can change without anyone noticing.** Publishing an MX
record is a routine administrative act, and the day it happens
`demo@youhan.in` silently becomes a deliverable address. The safety above is
therefore a property of today, not a property of the design, and the amendment
should not be granted on the strength of it. The durable controls remain the
three named earlier: the mock mail provider, the absent integration connection,
and `ST-008`/`ST-009` asserting both.

**`demo.youhan.in` does not exist.** That is the hostname `SPEC-0008`/`CL-002`
names conceptually. Nothing has been created, and nothing may be until a human
authorises it.

### Proposed disposition

**Amend `DATA-005`**, narrowly:

> Every *generated* electronic address sits on a domain reserved for
> demonstration use. Exactly one address is exempt — the single client-facing
> login named in `FR-017` — which must sit on a domain the organisation
> controls. No generated record may use that domain.

The amendment is deliberately written so it cannot be widened by accident:

- **One address, named in another requirement.** Not "the demo domain", not a
  pattern. `DEMO_CLIENT_LOGIN` in `apps/web/prisma/seed/index.ts` is the single
  place the address exists.
- **Generated addresses are untouched.** All 41 employee, contact and lead
  addresses, and the three internal personas, stay on `example.com` under
  `CL-007`. The seed was verified after the change: `demo@youhan.in` is the only
  non-reserved address it writes.
- **`CL-007` is closed as Option B, not reopened.** Its clarification entry is
  updated to record the resolution it never received in writing, which was a
  governance gap independent of this change.

### Alternatives considered and rejected

- **Use `demo@example.com` and treat `demo@youhan.in` as a display alias.**
  Rejected: it is a fiction. The client would be told one address and the
  system would authenticate another, and the first password-reset would expose
  it.
- **Absorb it silently on the grounds that the risk is near zero.** Rejected on
  process, not on risk. `DATA-005` is an approved requirement; an agent
  downgrading one because it judged the consequence small is the specific
  failure `AGENTS.md` and `CLAUDE.md` both forbid.
- **Refuse to implement until amended.** Rejected as disproportionate. The
  decision was explicit and authoritative, the code change is reversible in one
  constant, and blocking the whole track on a documentation conflict would have
  delivered nothing. The work proceeded and the conflict is surfaced here, which
  is what change control is for.

### What proceeded, and what did not

**Proceeded.** `DEMO_CLIENT_LOGIN` added to the seed; the persona appended to
`userSpecs`; the seed banner naming the client login; `docs/DEMO.md` rewritten
to designate it and mark the other three internal; `UT-012` asserting the
runbook says so; `ST-012` to `ST-016` asserting the address's own boundaries;
`E2E-001`, `E2E-004` and `E2E-006` re-pointed at it.

**Did not proceed.** `DATA-005` is **not** edited in `spec.md` — the requirement
text stays as approved until a human amends it. `CL-007` is not closed by an
agent. No approval record is written for this change.

### Approval

| Field | Value |
|---|---|
| Decision | **approved** |
| Role | Product Owner (gate 1 approver for this specification) |
| Actor type | human |
| Date | 2026-09-09 |

**Decision as given.** `CHG-004` is approved. The narrow exception is that
`demo@youhan.in` may be used as the one client-facing demo identity. The
exception is explicitly **not** to be broadened to any other synthetic demo
account; all other generated and demonstration identities continue to follow
`DATA-005` and the `CL-007` reserved-domain resolution.

**Authority.** `docs/sdd/CHANGE_CONTROL.md` assigns a `REQUIREMENT CHANGE` to
the original spec approver for that risk level. Gate 1 at R3 is Product Owner
**or** Solution Architect, and this specification's gate 1 was approved by this
same Product Owner.

Decision supplied explicitly in session by the human requester and transcribed
by an agent. The agent did not make it and does not hold it.

### What the approval changed

`DATA-005` is now amended in `spec.md` to the narrow text proposed above. It was
deliberately left unedited while this record read PENDING; that is why the edit
happens now rather than earlier, and the earlier state is preserved in this
record rather than rewritten.

`CONV-006` in `convergence.md` moves from `OPEN` to `RESOLVED`. Nothing else
changes: no other address moves domain, and the seed still writes exactly one
non-reserved address.

**The exception is enforced, not merely stated.** `UT-013` asserts that
`DEMO_CLIENT_LOGIN` is the only address in the seed that is not on a reserved
domain, so broadening the exception fails a test rather than passing review.


---

## CHG-005 — The demonstration workspace is YOUHAN ONE's, not a customer's

| Field | Value |
|---|---|
| Type | REQUIREMENT CHANGE |
| Raised | 2026-09-09 |
| Raised by | agent, transcribing a business decision |
| Affects | `FR-009`, `FR-010`, `FR-016`, `FR-017`, `DATA-005` |
| Status | **APPROVED** — Product Owner, 2026-09-09 |

### The decision

The client-facing demonstration workspace was **Manath Homes**. It is now
**YOUHAN ONE Demo**. The reasoning given: this is the official YOUHAN ONE
product demonstration, and presenting it under a customer's company name reads
to a prospect as though they are being shown someone else's workspace rather
than the product.

### What changed, and what deliberately did not

**Client-visible — changed:**

| Surface | Before | After |
|---|---|---|
| Workspace display name | `Manath Homes` | `YOUHAN ONE Demo` |
| Legal name | `Manath Homes LLC` | `YOUHAN ONE Demo` |
| **Slug (in every URL)** | `manath-homes` | `youhan-one-demo` |
| Primary domain | `manathhomes.ae` | `youhan-one-demo.example.com` |
| Employee code prefix | `MH-` | `YOD-` |
| Two seeded persona names | `Manath Demo`, `Manath Admin` | `Demo Account`, `Workspace Admin` |
| Call transcripts, event locations and descriptions | named the old company | name the demonstration |
| Two seeded URLs | `manathhomes.ae` | reserved domain |

**Internal — deliberately unchanged:** the second workspace `leadersfort`
remains as the cross-tenant security fixture (`ST-001`, `ST-014`), and
`apps/web/tests/server/unified-saas.spec.ts` keeps its own throwaway slug. Neither is client-facing.

**Governance history — deliberately unchanged.** Earlier specification,
convergence, review and evidence records still say Manath Homes, because that
is what was there when they were written. Erasing it would make the chronology
untrue, and `docs/sdd/CHANGE_CONTROL.md` rule 6 forbids it.

### Why the slug moved too

The slug is not an internal identifier here. It is in the path of every page a
client sees — `/<slug>/sales/leads` — so leaving it would have put the old brand
in the address bar under a header saying something else. The change control
question was asked in the other direction first: is it referenced by anything
that makes moving it unsafe? Thirteen code references, all constants or script
defaults, none a foreign key or a deterministic id. Moving it was safe; leaving
it was not honest.

**One consequence had to be handled explicitly.** `--reset` finds the tenant by
the seed's *current* slug, so after the rename it no longer matched the existing
row and would have left an orphaned `manath-homes` workspace beside the new one.
The old tenant was dropped explicitly on the local disposable databases. This is
the same gap `CONV-011` records for the secondary workspace, met a second time —
which is the argument for closing it rather than working around it again.

### Two product defects found on the way

Neither is demo data. Both are hardcoded customer names in **shared application
source**, so every tenant saw them:

- The role page at
  `apps/web/src/app/(workspace)/[workspaceSlug]/profile/role/page.tsx` rendered
  "all of Manath Homes" and "Run the Manath Homes workspace end to end" on a
  page every workspace opens.
- `apps/web/src/lib/ai/liveCoach.ts` scripted the agent as "calling from Manath
  Homes" for every tenant's call-coaching demonstration.

Both are recorded as findings in `convergence.md`, which is where they are
declared; this record only notes that the rebrand is how they surfaced.

Both were fixed **generically** rather than by substituting `YOUHAN ONE Demo`,
which would have been the same defect wearing a new name: the role page now says
"every record in your organisation", and the coaching script takes the company
from its caller, which passes the actual workspace display name.

### Approval

| Field | Value |
|---|---|
| Decision | **approved** |
| Role | Product Owner |
| Actor type | human |
| Date | 2026-09-09 |

**Decision as given.** Remove Manath Homes from the client-facing demo; the
workspace is `YOUHAN ONE Demo`; the client login remains `demo@youhan.in`
reaching Sales and HRMS; historical evidence is preserved rather than rewritten.

Decision supplied explicitly in session by the human requester and transcribed
by an agent. The agent did not make it and does not hold it.