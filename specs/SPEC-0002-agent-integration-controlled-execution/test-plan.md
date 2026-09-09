# SPEC-0002 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Author | Solution Architect |
| Date | 2026-09-07 |

Runner: `node --test tools/sdd/tests/agent.test.mjs`. Separate file from the
B2 suite so the two can be run and reasoned about independently.

## Cases

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `UT-001` | UT | `FR-001` | Preflight passes on a valid R2 implementer request |
| `UT-002` | UT | `FR-002` | Session creation writes a well-formed record |
| `UT-003` | UT | `FR-003` | Session creation refuses when preflight fails |
| `UT-004` | UT | `FR-010` | Exit codes: 0 clean, 1 finding, 2 tooling failure |
| `UT-005` | UT | `NFR-003` | Agent JSON output is deterministic across runs |
| `UT-006` | UT | `FR-009` | Every agent finding carries a known rule id |
| `UT-007` | UT | `NFR-002` | Windows and POSIX path forms give the same result |
| `IT-001` | IT | `FR-001` | R1 lightweight flow: preflight, session, verification |
| `IT-002` | IT | `FR-001`, `FR-002` | R2 implementation session end to end |
| `IT-003` | IT | `FR-008` | R3 implementation plus independent review |
| `IT-004` | IT | `SEC-004` | R4 with security review and a human-required gate record |
| `IT-005` | IT | `FR-004` | Scope check with only in-scope files changed |
| `IT-006` | IT | `FR-007` | Verification record with passing tests validates |
| `IT-007` | IT | `FR-008` | Valid handoff from implementer to reviewer |
| `IT-008` | IT | `AC-007` | The B2 suite and `validate --all` still pass |
| `ST-001` | ST | `SEC-005` | An out-of-scope changed file is reported |
| `ST-002` | ST | `SEC-002` | A traversing `allowedPaths` entry is rejected |
| `ST-003` | ST | `SEC-002` | A symlink escaping an allowed directory is rejected |
| `ST-004` | ST | `SEC-004` | An AI review cannot satisfy a human-required gate |
| `ST-005` | ST | `SEC-005` | A session actor cannot independently review its own work |
| `ST-006` | ST | `FR-006` | Drift is reported, and nothing is written to drifted files |
| `ST-007` | ST | `SEC-001`, `SEC-003` | No dynamic execution; a hostile git ref is refused |
| `ST-008` | ST | `SEC-006` | Records carry no command output and no secret |
| `REG-001` | REG | `DATA-001` | Agent commands other than `create-session` write nothing |

## Cases added by CHG-001

`ST-009` verifies `TASK-011`. `UT-008` to `UT-017` verify `TASK-012` and are
the ten session-delta attribution cases the remediation was required to cover.

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `ST-009` | ST | `SEC-001`, `SEC-003` | Every file permitted to import `child_process` uses fixed-argument execution with the shell disabled |
| `UT-008` | UT | `FR-004` | A pre-existing dirty file the session never touched is not attributed to it |
| `UT-009` | UT | `FR-004` | A clean file the session modified inside scope passes |
| `UT-010` | UT | `FR-004` | A clean file the session modified outside scope fails |
| `UT-011` | UT | `FR-004` | A pre-existing dirty file modified again by the session, inside scope, passes |
| `UT-012` | UT | `FR-004` | A pre-existing dirty file modified again by the session, outside scope, fails |
| `UT-013` | UT | `FR-004` | A file newly created during the session is attributed to it |
| `UT-014` | UT | `FR-004` | A deleted file is attributed and judged against scope |
| `UT-015` | UT | `FR-004` | A rename is attributed on both paths where git reports it |
| `UT-016` | UT | `NFR-002` | Attribution is stable across Windows and POSIX path separators |
| `UT-017` | UT | `FR-006` | A path whose origin cannot be established raises a review warning, never a silent pass |

## Cases added by CHG-005

`UT-018` to `UT-025` verify `TASK-014`, the convergence verdict parser.
`UT-026` to `UT-035` verify `TASK-015`, R3 specification-approval
enforcement.

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `UT-018` | UT | `FR-009` | `PASS` reads as `PASS` |
| `UT-019` | UT | `FR-009` | `PASS WITH ACCEPTED LIMITATIONS` reads as itself, not as `PASS` |
| `UT-020` | UT | `FR-009` | `FAIL` reads as `FAIL` |
| `UT-021` | UT | `FR-009` | `PASS SOMETHING ELSE` is rejected as unsupported |
| `UT-022` | UT | `FR-009` | `PASS WITH ACCEPTED` is rejected as unsupported |
| `UT-023` | UT | `NFR-003` | Leading, trailing and repeated whitespace normalise |
| `UT-024` | UT | `FR-009` | A verdict word embedded in prose is not read as the declaration |
| `UT-025` | UT | `FR-009` | Conflicting duplicate declarations are rejected, not silently resolved |
| `UT-026` | UT | `FR-009` | R3 with a Product Owner human specification approval passes |
| `UT-027` | UT | `FR-009` | R3 with a Solution Architect human specification approval passes |
| `UT-028` | UT | `FR-009` | R3 implementing with no specification approval is rejected |
| `UT-029` | UT | `SEC-004` | An `ai` actor cannot satisfy the specification gate |
| `UT-030` | UT | `FR-009` | An unsupported approving role is rejected |
| `UT-031` | UT | `FR-009` | An approval for another gate does not satisfy this one |
| `UT-032` | UT | `SEC-004` | An approval naming another specification does not satisfy this one |
| `UT-033` | UT | `FR-009` | A malformed approval record is rejected |
| `UT-034` | UT | `FR-009` | R2 is unaffected; its own policy still applies |
| `UT-035` | UT | `FR-009` | The R4/R5 implementation-readiness gate is unchanged |

Approval ordering is checked separately from approval presence, so a
specification that has the right approval recorded late is distinguishable
from one that has none at all.

`UT-017` is the one that matters most. Where attribution is not deterministic
the answer is *review required*, not *safe*. A scope checker that guesses in
the permissive direction is worse than none, because it looks authoritative.

## Invalid-fixture matrix

Each fixture is built to trigger one rule. The test asserts the command fails
and that the specific rule identifier is emitted.

| Fixture | Expected rule |
|---|---|
| Invalid or unknown agent role | `SDD-V042` |
| Implementer preflight before the lifecycle permits it | `SDD-V043` |
| Requested task does not exist | `SDD-V044` |
| Session references a nonexistent task | `SDD-V044` |
| Task declares no allowed scope | `SDD-V045` |
| Changed file outside approved task scope | `SDD-V046` |
| Malformed agent session record | `SDD-V047` |
| Session claims a different specification | `SDD-V048` |
| Required verification record missing | `SDD-V049` |
| Malformed review record | `SDD-V050` |
| Implementer records the review of its own session | `SDD-V051` |
| Repository drift invalidates task assumptions | `SDD-V052` |
| AI review offered against a human-required gate | `SDD-V053` |
| Verification cites a test absent from the test plan | `SDD-V054` |
| Review cites a nonexistent execution session | `SDD-V055` |
| Traversal or symlink escape in `allowedPaths` | `SDD-V056` |
| Completion claimed with required tests absent | `SDD-V057` |
| Protected path modified without approved scope expansion | `SDD-V058` |
| Missing required approval at a gated risk level | `SDD-V020` |
| Task with no requirement linkage | `SDD-V026` |

## Coverage sections

**Happy paths** — `IT-001` to `IT-007`, one per risk level plus the record
types.

**Negative behaviour** — the 20-row matrix above.

**Authorization** — `ST-004`, `ST-005`: the two ways the approval model can be
defeated structurally.

**Tenant isolation** — not applicable; no tenant data.

**Failure paths** — `UT-004` for exit codes, malformed records as findings.

**Malformed input** — malformed session and review records, hostile git ref.

**Boundary conditions** — empty diff, task with no scope, session with no
tests, R1 with minimal artefacts.

**Concurrency** — `ST-006`, repository drift.

**Retries and idempotency** — `REG-001`, `UT-005`.

**External dependency failure** — git unavailable or an unresolvable range is
reported, never guessed.

**Regression coverage** — `IT-008` pins that B3 did not disturb B2.

## Requirement coverage

| Requirement | Tests |
|---|---|
| `FR-001` | `UT-001`, `IT-001`, and the preflight fixtures |
| `FR-002` | `UT-002`, `IT-002` |
| `FR-003` | `UT-003` |
| `FR-004` | `IT-005`, `ST-001` |
| `FR-005` | `ST-002`, `ST-003` |
| `FR-006` | `ST-006` |
| `FR-007` | `IT-006`, the `SDD-V054` fixture |
| `FR-008` | `IT-003`, `IT-007`, the `SDD-V050` and `SDD-V055` fixtures |
| `FR-009` | `UT-006` |
| `FR-010` | `UT-004` |
| `NFR-001` | dependency check, `AC-007` |
| `NFR-002` | `UT-007` |
| `NFR-003` | `UT-005` |
| `NFR-004` | `IT-008` |
| `SEC-001` | `ST-007` |
| `SEC-002` | `ST-002`, `ST-003` |
| `SEC-003` | `ST-007` |
| `SEC-004` | `ST-004`, `IT-004` |
| `SEC-005` | `ST-001`, `ST-005` |
| `SEC-006` | `ST-008` |
| `DATA-001` | `REG-001` |
| `DATA-002` | `ST-008` |
| `OBS-001` | `UT-006` |
| `OBS-002` | `IT-002` |

Every requirement has a test. Every `SEC-` requirement has an `ST-` test.

## Execution record

Results are recorded in
`docs/evidence/phase-b3-agent-integration/agent-test-results.md`.

`UT-046` to `UT-055` verify `TASK-018`, the scope-declaration parser
remediation raised as `SPEC-0003/CONV-008` and authorised by `CHG-007`. Every
fixture is synthetic except `UT-055`, which reads the repository's own
specifications to prove existing artefacts still parse as they should.

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `UT-046` | UT | `FR-004` | The original defect: a filename fragment named in prose is not admitted as an allowed path |
| `UT-047` | UT | `FR-004` | A prohibited path described in prose is reported, never silently lost |
| `UT-048` | UT | `FR-004` | Several allowed paths spanning several lines all parse, with no problem raised |
| `UT-049` | UT | `FR-004` | Several prohibited paths parse in full — no partial-list truncation |
| `UT-050` | UT | `FR-004` | A backticked identifier such as `CHG-001` is ignored rather than turned into a path |
| `UT-051` | UT | `FR-004` | A glob is refused, because `CL-002` permits exact paths and directory prefixes only |
| `UT-052` | UT | `FR-004` | A declaration that is wholly prose yields no paths and is reported |
| `UT-053` | UT | `FR-004` | An absent declaration is not reported as malformed — that is `SDD-V045`'s business |
| `UT-054` | UT | `FR-004` | The declaration ends at the next field and does not swallow later prose |
| `UT-055` | UT | `FR-004` | Existing specifications still parse: clean declarations stay clean, known-malformed ones are reported |

`UT-046` and `UT-047` are the meaningful pair. Both **fail** against the
pre-remediation parser — it returned `tablesearch-a11y` as an allowed path and
reported nothing at all about the prohibited boundary it had dropped — and
both pass after it. The demonstration re-implements the old `collect()`
verbatim rather than reverting the file.

`UT-056` to `UT-063` verify `TASK-019`, and `UT-068` to `UT-071` verify
`TASK-020`. Both were raised by `SPEC-0003` and authorised by `CHG-008`.

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `UT-056` | UT | `FR-004` | A closed session reports the same result it had when it ran |
| `UT-057` | UT | `FR-004` | A later session's edit to a path the first prohibited is not blamed on the first |
| `UT-058` | UT | `FR-004` | A prohibited edit made *during* the session still fails, before and after closing |
| `UT-059` | UT | `FR-006` | A genuinely unattributable change stays visible after closing |
| `UT-060` | UT | `FR-006` | A closed session with no end-state evidence reports a limited state and blames nobody |
| `UT-061` | UT | `FR-004` | An in-flight session is still judged against the live tree — enforcement unchanged |
| `UT-062` | UT | `FR-004` | Pre-existing work stays `PRE_EXISTING` across closing |
| `UT-063` | UT | `FR-004` | End-state evidence is captured once and is not silently refreshed |
| `UT-068` | UT | `FR-001` | A non-path identifier in a scope declaration is reported repository-wide |
| `UT-069` | UT | `FR-001` | A glob in a scope declaration is reported repository-wide |
| `UT-070` | UT | `FR-001` | Prose mixed into a declaration is reported, and so is a prose prohibition |
| `UT-071` | UT | `FR-004` | A clean declaration emits nothing, and the rule never fails a run on its own |

`UT-057` and `UT-060` are the pair that matter for `CONV-009`. `UT-057` proves
a closed session is no longer blamed for later work; `UT-060` proves a session
closed *before* this change — which is every session that already exists —
reports a documented limited state instead of an invented attribution.

`UT-058` is the guard against over-correcting: a session that genuinely crossed
its own boundary still fails, both while open and after closing.
