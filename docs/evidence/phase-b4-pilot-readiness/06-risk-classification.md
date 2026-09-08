# 06 — Risk classification

> **SUPERSEDED IN PART by `13`.** The R3 classification argued below was
> withdrawn on 2026-09-08: the authoritative language is ambiguous and
> `PC-01` is now `UNRESOLVED`, registered as `EVC-016`. The reasoning is kept
> on record as what was offered, not as a settled class.

**Phase:** B4.0 · **Date:** 2026-09-08
**Model:** `docs/RISK_CLASSIFICATION.md` (authoritative), operationalised by
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`.

Where classification was uncertain the **higher** justified class was taken and
the reasoning stated. No candidate was downgraded to make it eligible.

## Per-dimension assessment

| Dimension | PC-01 | PC-02 | PC-03 | PC-04 | PC-05 |
|---|---|---|---|---|---|
| Authentication | none | none | none | none | none |
| Authorization | none — `assertPermission` untouched | none | none | none | none |
| Tenant isolation | none | none | none | none | none |
| Data sensitivity | **HR PII in the export payload** | none | none | none | none |
| Database | none | none | none | none | none |
| Migration | none | none | none | none | none |
| API surface | none — all four are client components | none | none | none | none |
| Business logic | none — encoding only, no row/column change | none | none | none | none |
| External integrations | none | none | none | none | none |
| Security | **improves** a defence (formula injection) | none | none | none | none |
| Blast radius | 3 pages, export button only | 6 call sites | 4 call sites | 4 call sites | 1 component |
| Rollback | code-only | code-only | code-only | code-only | code-only |
| Testability | high — `csv.spec.ts` is the template | medium | high | low without a browser | high |
| Observability | unchanged | unchanged | unchanged | unchanged | unchanged |
| Dependencies | none added | none | none | none | none |

## Classifications

| Candidate | Class | Reasoning |
|---|---|---|
| **PC-01** | **R3** | Touches PII-bearing export output in business code. Not R2, because "a non-security bug fix in a service" understates a change to how personal data is encoded for export. Not R4 in the proposed scope — see the boundary note |
| **PC-02** | **R2** | Client-side UI behaviour over existing rendered rows. No data, no endpoint |
| **PC-03** | **R2** | Markup attribute on an existing component. Arguably R1; R2 taken because it is shared across pages |
| **PC-04** | **R2** | Client-side download mechanics. No data change |
| **PC-05** | **R1** | Dead-code removal with zero call sites |

## The R3/R4 boundary on PC-01 — stated, not buried

`docs/RISK_CLASSIFICATION.md` places at **R4**: "PII/biometric handling".

Two readings exist and a Solution Architect should settle it rather than
inherit my view:

**Reading A — R3.** The change alters how a cell is *escaped*. It does not
change which rows are exported, which columns, who may export, retention, or
where the data goes. No new outbound flow, no field or visibility rule change.
The data is already on the authorised user's screen before the button is
pressed. "PII handling" is not triggered by re-encoding an existing export.

**Reading B — R4.** The export payload is employee personal data, and any
change to code that emits PII is PII handling.

**What was done about it.** The proposed scope **excludes
`people/face-activity`**. That page is biometric-adjacent, and `biometric
handling` is a named R4 trigger with no ambiguity at all. Excluding it keeps
the pilot cleanly inside Reading A. It is scoping down, not classifying down —
and the excluded page is named as follow-on work rather than quietly dropped.

If the Solution Architect takes Reading B, **PC-01 becomes R4 and is
disqualified as pilot #1** under this phase's own exclusion rules. That
outcome is acceptable and is why the boundary is flagged rather than resolved
here.

## Escalation triggers checked

None of the five fires any trigger in `docs/RISK_CLASSIFICATION.md`: no
`src/lib/auth/*` or `src/lib/security/*`, no tenant/permission/visibility
movement, no migration, no new environment variable, no new outbound data flow,
no retention/audit/biometric change — **provided `face-activity` stays out of
`PC-01`**.
