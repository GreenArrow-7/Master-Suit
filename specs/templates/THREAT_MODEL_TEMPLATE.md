# SPEC-NNNN — Threat model

> Copy to `specs/SPEC-NNNN-short-slug/threat-model.md`.
> Required at R4 and R5; at R1–R3 only when the change is security-sensitive
> (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`). Depth is proportional to risk — a
> cosmetic R1 change does not need this document.
> Do not write an exploit path or a working payload. Describe the class of
> problem and the control.

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Author | functional role |
| Security reviewer | Application Security |
| Date | YYYY-MM-DD |

## Scope of this analysis

What is being analysed, and what is deliberately excluded because an existing
control already covers it. Cite the existing control rather than re-deriving
it: `docs/security/SECURITY_MODEL.md` lists the platform's trust boundaries.

## Assets in scope

What an attacker would want here: customer data, HR or biometric records,
credentials, audit evidence, integration secrets, availability.

## Trust boundaries crossed

Which of the platform's boundaries this change touches. If it introduces a new
one, say so explicitly — a new boundary is an architecture decision.

## Threats

### TH-001

**Asset:**
**Trust boundary:**
**Threat actor:** anonymous internet, authenticated tenant user, another
tenant, a privileged platform role, a compromised integration, an insider,
a background job.
**Threat:** what could go wrong, as a class.
**Attack path:** the sequence at a level of detail useful to a defender, not
a reproduction recipe.
**Preconditions:** what the attacker needs first.
**Impact:** confidentiality, integrity, availability, and the business
consequence.
**Existing controls:** what already stops or limits this today, cited.
**Required controls:** `CTRL-001`
**Verification:** `ST-001`
**Residual risk:** what remains after the controls, and who accepts it.
**Status:** `OPEN` / `MITIGATED` / `ACCEPTED_RISK` / `NOT_APPLICABLE`

## Controls

### CTRL-001

**Control:**
**Threats addressed:** `TH-001`
**Requirements supported:** `SEC-00x`
**Implementation:** which task delivers it — `TASK-00x`
**Verification:** `ST-00x`
**Owner:** functional role

## Traceability

| Threat | Control | Security requirement | Test | Status |
|---|---|---|---|---|
| `TH-001` | `CTRL-001` | `SEC-001` | `ST-001` | |

Every threat has a control or an accepted residual risk with a named owner.
Every control has a verification. A control nothing verifies is an intention.

## Residual risk acceptance

| Risk | Accepted by (role) | Date | Condition for revisiting |
|---|---|---|---|

An AI agent may draft this analysis. Accepting residual security risk is
Application Security's decision (`docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 3).
