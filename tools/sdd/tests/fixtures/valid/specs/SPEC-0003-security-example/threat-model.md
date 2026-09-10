# SPEC-0003 — Threat model

## Threats

### TH-001

**Threat:** A caller outside the group reads rows.
**Required controls:** `CTRL-001`
**Verification:** `ST-001`
**Status:** `MITIGATED`

## Controls

### CTRL-001

**Control:** Apply the existing scope filter.
**Requirements supported:** `SEC-001`
**Verification:** `ST-001`
