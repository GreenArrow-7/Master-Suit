# Production incident — discovery packet

| Field | Value |
|---|---|
| Mode | Production incident / functionality restoration, P0 |
| Date | 2026-09-08 |
| Status | **DISCOVERY BLOCKED — no symptom supplied, no production access** |
| Prepared by | AI agent |

> **No production incident has been diagnosed, and none is claimed.**
>
> Two things are missing and neither can be substituted: a description of what
> is failing, and access to the environment where it fails. Phase 3 of the
> instruction is explicit — *"Do NOT invent production incidents from local
> failures"* — so this register contains none.

---

## 1. Version facts — established first, as instructed

*"Never diagnose a production symptom against the wrong version of the code."*

| Ref | SHA | Contains RC-4 fix? |
|---|---|---|
| `origin/main` — what production deploys from | **`f16ed67`** | **NO** |
| `origin/dev/yourhan-next` — canonical RC | `e620171` | yes |
| Local `HEAD` | `a04c7e3` | yes |
| RC-4 product commit | `1f46c78` | — |
| **Production deployed SHA** | **UNKNOWN** — requires operator | — |

**The single most important fact in this document:** none of `f1c4d4b`,
`1f46c78`, `e620171` or `a04c7e3` is an ancestor of `origin/main`. Verified with
`git merge-base --is-ancestor`, all four returned NO.

**Therefore production cannot be running any change from this workstream**, and
no change from this workstream can have caused a production symptom. Whatever
production runs is `f16ed67` or older.

## 2. What production is missing, exactly

The product-code delta from `f16ed67` to `HEAD` is **two files**:

| File | Change | Fixes |
|---|---|---|
| `apps/web/src/components/workspace/TableSearch.tsx` | +22 | `SPEC-0003` — search results not announced to assistive technology |
| `apps/web/src/services/hr/captureVault.ts` | +92 / −13 | `SPEC-0005` / RC-4 — platform-dependent capture keys; retention reporting success while deleting nothing |

Everything else in the release candidate is tests, tooling, governance and
evidence.

**Two evidence-based hypotheses, offered as hypotheses and nothing more.** If
the reported symptom turns out to be either of these, the fix already exists and
is sitting in the release candidate:

1. **Screen-reader / accessibility on table search** — filtered result counts
   are not announced. Present in `f16ed67`, fixed by `SPEC-0003`.
2. **Attendance capture retention** — on a POSIX host reading a
   Windows-written key, `deleteCapture` removes nothing, returns normally, the
   punch row is then deleted, and the encrypted biometric image is orphaned
   while the sweep reports success. Present in `f16ed67`, fixed by RC-4.

Hypothesis 2 is silent by construction — it produces no error and no alert — so
it would not appear in a log search. It is found by reconciling bucket objects
against `capturePath` rows, not by watching for failures.

**Neither is asserted as the reported symptom.** No symptom was described.

## 3. What is blocking discovery

| Requirement | State |
|---|---|
| Description of the failing functionality | **not supplied** |
| Production deployed SHA | unknown — needs operator |
| Production logs | no access |
| Production metrics / health | no access |
| Production database (read-only) | no access |
| `gh` authentication | absent — `gh auth status` reports not logged in |
| `DEPLOY_HOST/USER/KEY_production` | GitHub Actions secrets, not on this workstation |

## 4. Local functionality evidence — what the code itself shows

This is not production evidence and is not offered as such. It establishes
whether the *codebase* has broken flows, which narrows what a production
symptom can be.

| Suite | Result |
|---|---|
| Product suite ×3 | 1933 pass · **0 fail** · 2 skip of 1935 |
| Capture-vault targeted | 28 / 28 |
| Linux POSIX security | 20 / 20 |
| B2 / B3 | 93/93 · 70/70 |
| `validate --all` | 0 errors |
| Full E2E suite, 15 specs | *see the run recorded alongside this document* |

The E2E specs cover the Phase 1 matrix directly: `auth-mfa`, `password-reset`,
`invitation`, `crm-lifecycle`, `hr-modules`, `every-route`,
`entity-navigation`, `modules`, `mobile`, `csp`, `ui-states`, `acceptance`,
`platform-workspace-edit`, `request-budget`, `tablesearch-a11y`.

## 5. Incident register

| Class | Count |
|---|---|
| **PRODUCTION-OBSERVED** | **0** |
| LOCAL/CI-ONLY | 2 — `BUG-002`, `BUG-003`, both SEV-4, both governance/tooling |
| HISTORICAL | 3 — `BUG-001` (fixed as RC-4), `BUG-004`, `BUG-005` (both fixed) |
| UNKNOWN | production health in its entirety |

SEV-1 **0** · SEV-2 **0** · SEV-3 **0** · SEV-4 **2**.

Zero production-observed entries is a statement about what has been measured,
not a claim that production is healthy.

---

## 6. What is needed to proceed — two things, either order

### A. The symptom

The fastest route by a wide margin. One or two sentences is enough:

- what a user does, and what happens instead
- which screen, route or feature
- when it started, if known
- whether it affects every workspace or one
- any error text the user sees

With that, most of Phase 4's root-cause trace can be done against the code
without production access at all — because the code for `f16ed67` is right here.

### B. Read-only production evidence

The operator packet is
`26-production-readiness-operator-packet.md`. For incident discovery
specifically, the highest-yield six, in order:

| # | Check | Answers |
|---|---|---|
| 1 | `docker inspect <web-image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` | **the deployed SHA** — without it every diagnosis is against a guess |
| 2 | `docker compose ps` | which services are up, restarting or unhealthy |
| 3 | `docker compose logs --since 24h --tail 500 web \| grep '"level":50'` | recent errors — **filter identifiers before sharing** |
| 4 | `docker compose logs --since 24h --tail 200 worker` | background job failures |
| 5 | Prometheus `sum by (status) (rate(http_requests_total[1h]))` | 4xx/5xx distribution, failing routes |
| 6 | `curl -sS -o /dev/null -w '%{http_code}' https://<host>/api/health` | is the app answering at all |

Read-only. No restart, no write, no migration, no config change, no secret
printed.

## 7. What was deliberately not done

- **No production incident invented** from the local or historical defects.
- **No code changed.** Phase 1 forbids changing code before concrete failing
  flows are identified, and none have been.
- **No completed specification reopened.** Nothing in the available evidence
  challenges an assumption in `SPEC-0003`, `SPEC-0004` or `SPEC-0005`.
- **No production access fabricated**, and no evidence invented to fill the gap.
