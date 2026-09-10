# SPEC-0008 — Clarifications

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Last updated | 2026-09-08 |

Four material ambiguities. Two must be answered before provisioning begins;
neither blocks approval of the specification itself. Two carry defaults.

---

- `CL-001` — Where does the demo environment run?

**Status:** RESOLVED · Product Owner decision, 2026-09-09.

**Resolution.** A dedicated demo environment: `APP_ENV=demo` on its own
database, not the production customer database and carrying no production
customer data. The hosting shape is to be the safest practical option supported
by the existing architecture; nothing is to be invented.

**Recommended option: (B) a separate VM**, following the single-VM pattern the
repository already automates (`provision-host.sh`, `cloud-init.yaml`, the
Compose + Caddy stack). It is the only option that honours `SEC-002` and
`NFR-001` without qualification. Option (A), a second Compose project on the
staging host, is cheaper but puts a publicly demonstrated environment in
staging's failure domain — staging being the environment that gates production
releases. Option (C), the Azure variant, is viable where that platform is
already in use.

**Still required before provisioning:** which host. That is a procurement fact,
not an engineering one, and no evidence of an available host exists in the
repository.

**Question as raised.** The repository shows a single-VM Compose deployment pattern and an
Azure variant. It does not show what hosting capacity exists, what it costs, or
whether a fifth environment can be added to it.

**Options.** A separate small host, matching the existing single-VM pattern; a
second Compose project on the staging host; or a managed environment following
the Azure variant.

**Consideration.** Co-locating with staging is the cheapest and the worst for
`SEC-002` and `NFR-001`: it puts a publicly demonstrated environment on the host
that rehearses production, and shares a failure domain with the environment that
gates production releases. A separate host is the recommendation, and the cost
of that recommendation is exactly the decision being asked for.

**Decision owner.** DevOps / Production Engineering, with the budget holder.

---

- `CL-002` — What address does the demonstration use, and is it public?

**Status:** PARTIALLY RESOLVED · Product Owner decision, 2026-09-09.

**Resolution.** The demonstration must be browser-accessible to clients over
**HTTPS**, publicly reachable rather than network-restricted. Public exposure
carries the stated conditions: HTTPS, authentication, no debug mode, no exposed
database, no public admin console, rate limiting and brute-force controls, and
safe outbound providers. The conceptual hostname is `demo.<company-domain>`.

**Still required:** the actual domain. The decision explicitly forbids
inventing or configuring DNS until an available domain is verified and
authorised, and **no domain, DNS record or certificate for a demo host exists
anywhere in this repository**. Provisioning cannot begin without it.

**Question as raised.** A demonstration needs a stable address a prospect can be shown.
The repository establishes no domain, no certificate and no DNS control.

**Sub-question.** Is the address publicly reachable, or restricted to the
organisation's network with the demonstration screen-shared? Public is more
convincing and enlarges the attack surface of a system holding no real data;
restricted is safer and constrains how demonstrations can be run.

**Default if undecided.** Restricted, on the basis that it is the reversible
choice. Widening later is a configuration change; narrowing after a prospect has
been given a link is not.

**Decision owner.** DevOps / Production Engineering, with Product and
Application Security.

---

- `CL-003` — What is an acceptable rebuild time?

**Status:** OPEN · Default applies if undecided.

**Question.** `NFR-002` asserts "within one working session" deliberately rather
than inventing a number nobody approved.

**Default if undecided.** No threshold is enforced. The provisioning rehearsal
records the observed duration, and a threshold is set from that observation.

**Decision owner.** DevOps / Production Engineering.

---

- `CL-004` — Does the demo environment need backups at all?

**Status:** RESOLVED · Answered from the specification's own requirements.

**Question.** The repository has a backup schedule, a restore-verification
script and a freshness check, all built for production.

**Resolution.** No scheduled backup. The environment holds only synthetic data
that a seed reproduces deterministically, so the recovery path for data loss is
a re-seed, not a restore. `FR-011` requires rollback to work without data
restoration for exactly this reason, and `DATA-002` forbids restoring a demo
backup into another environment. This keeps the environment genuinely
disposable and avoids creating a backup artefact whose only possible use is a
mistake.

`EVC-005` is an open conflict about backup capability. This resolution does not
touch it: the decision here is that this environment needs no backup, which is
independent of whether the production backup capability is adequate.


---

- `CL-005` — Is automatic synchronisation to demo authorised, or must every demo
  deployment be dispatched by a human?

**Status:** RESOLVED · Product Owner decision, 2026-09-09. **Option C.**

**Resolution.** Parity is detected automatically and deployed manually. The
system may compute `IN_SYNC`, `DEMO_BEHIND`, `DEMO_AHEAD` or `DIVERGED` on its
own, and must not deploy because it found drift. On `DEMO_BEHIND` it reports the
exact commit difference and offers the approved deployment action.

**No standing autonomous deployment credential is created at this stage.** That
is the operative half: `TH-014` is neutralised by the automation not possessing
the means, rather than by a condition it could later be edited out of. `SEC-009`
is narrowed to match — the parity job holds no deployment credential for any
environment, demo included.

The question below is retained as raised.

**Question.** The requirement permits automatic synchronisation *"only if
`SPEC-0008`'s threat model and approval gates explicitly authorize it."* This
entry is that authorisation, asked rather than assumed.

**Options.**

- **A — Manual dispatch only.** Every demo deployment is a `workflow_dispatch`.
  Simplest, no new automation surface, and demo drifts exactly as far as
  somebody forgets.
- **B — Automatic on `DEMO_BEHIND` after a production release.** What the
  requirement describes. Demo tracks production without anyone remembering, and
  a job now exists that can deploy without a human in the loop.
- **C — Automatic detection, manual deployment.** Parity is computed and
  reported on every release; deploying demo stays a human action. Drift becomes
  visible immediately, and nothing deploys unattended.

**Consideration.** The security distance between B and C is larger than it
looks. In C nothing new can deploy anything; in B a scheduled job holds a
deployment credential, and `TH-014` is about what that job becomes after six
months of edits. Against that, `OBS-005` and the drift policy exist precisely
because option A's failure mode — silent months-long drift — is the problem the
requirement was raised to stop, and C only reports it rather than fixing it.

**Recommendation: C first, B later if the reporting proves the job would have
been right every time.** It gets the whole benefit the requirement actually
names — no silent drift — at none of `TH-014`'s cost, and B remains available
once there is evidence rather than expectation behind it.

**Default if undecided.** C. It is the reversible one: widening C to B is adding
a credential, narrowing B to C after an unattended deployment has gone wrong is
an incident review.

**Decision owner.** Application Security at gate 3, with DevOps.

---

- `CL-006` — What is the drift target, and who owns a mismatch?

**Status:** OPEN · Default applies if undecided.

**Question.** `OBS-005` requires an intentional mismatch to carry a reason, an
owner and an expected resolution. It does not say how long an *unintentional*
one may last, and the requirement says only "promptly".

**Default if undecided.** Demo reaches the production release within **one
working day**, and a `DEMO_BEHIND` state older than that is reported on the
release channel until it is resolved or recorded as intentional. The number is a
default rather than a recommendation: it is short enough that drift is noticed
and long enough that a genuine blocker gets a day to be understood.

**Decision owner.** Product Owner, with DevOps.
