# EVC-004 — production RLS evidence, for Application Security disposition

**This document does not dispose of `EVC-004`.** It assembles the evidence the
disposition needs and stops. The decision belongs to an authorized Application
Security reviewer, who must return exactly one of `ACCEPT`,
`REQUEST_MORE_EVIDENCE` or `FAIL`.

Prepared 2026-09-09. All production evidence below is read-only: `SELECT`
against catalogue views, plus `scripts/check-rls.mjs`, which was read first and
contains no `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE` or `DROP`.

## What the disposition rule says

`docs/evidence/phase-b4-pilot2-readiness/26-production-readiness-operator-packet.md`,
Packet C: *"Application Security uses the observed result to disposition
`EVC-004`. Running the query does not close it, and a production result that
disagrees with the local baseline blocks release."*

So: agreement with the baseline is necessary and **not** sufficient. It removes
the blocking condition; it does not constitute the decision.

## Observed on production, as the application role

Connected as `master_saas_app` — the role the running application actually uses
(`DATABASE_URL` in `apps/web/.env.production`), not the owner.

| Measure | Production | Local baseline | Agrees |
|---|---|---|---|
| tables in `public` | 202 | 202 | yes |
| RLS enabled | 181 | 181 | yes |
| RLS **forced** | 181 | 181 | yes |
| policies | 181 | 181 | yes |
| bootstrap tables exempt | 7 | 7 | yes |
| `rolsuper` | `false` | `false` | yes |
| `rolbypassrls` | `false` | `false` | yes |

`node apps/web/scripts/check-rls.mjs` against the production database returns
the repository's own gate text verbatim:

```
[check-rls] 181 tenant-owned tables: RLS enabled, FORCED, and policied.
            7 bootstrap tables exempt.
```

`scripts/check-raw-sql-scope.mjs` also passes: *"12 raw statement(s) touching
181 RLS-forced tables — all inside a tenant transaction."*

## Corroboration beyond the catalogue

The catalogue says the policies exist. These say they bite.

1. **A policy denying at runtime.** As `master_saas_app` with no
   `app.tenant_id` set, `SELECT count(*) FROM "Lead"` returns **0** against a
   database that holds leads. That is the policy refusing, not an empty table.
2. **Cross-tenant refusal through the application**, on the deployed image: an
   administrator of one workspace deleting another workspace's lead receives
   `404` and the row's `deletedAt` stays null.
3. **The disposable stack used for all incident reproduction was compared with
   production before it was trusted** — identical migration set (66), identical
   policies, identical `relrowsecurity` / `relforcerowsecurity` across all 202
   tables, identical `master_saas_app` grants across all 202 tables. Findings
   reproduced there therefore carry to production.

## What this evidence does not cover — read before deciding

- **Catalogue posture, not policy correctness.** It proves 181 tables have RLS
  forced and a policy attached. It does **not** prove each policy expresses the
  right predicate. A policy that is present and wrong counts as 181 here.
- **One tenant.** Production holds a single workspace, so cross-tenant
  behaviour cannot be observed there at all. Every isolation result above comes
  from the disposable stack, which has two.
- **`SEC-OBS-014` / `BUG-008` is not an RLS finding** and does not bear on this
  disposition. It is an application-layer rendering defect: a refused
  `GET /platform` returned the control-plane page in the redirect body. It has
  been remediated and is pending its own AppSec review. It is named here so the
  reviewer is not surprised by it, not because it belongs to `EVC-004`.
- No penetration testing, no policy-by-policy predicate review, and no attempt
  to bypass RLS were performed.

## Reproducing this, read-only

```sh
# As the application role. Catalogue only; returns seven integers.
SELECT count(*) AS tables,
       count(*) FILTER (WHERE c.relrowsecurity)      AS rls_enabled,
       count(*) FILTER (WHERE c.relforcerowsecurity) AS rls_forced,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;

# Or the repository's own gate:
DATABASE_URL=<application role> node apps/web/scripts/check-rls.mjs
```

## Decision — to be completed by Application Security

| Field | Value |
|---|---|
| Disposition | `ACCEPT` / `REQUEST_MORE_EVIDENCE` / `FAIL` — **not yet recorded** |
| Reviewer role | |
| Date | |
| If `REQUEST_MORE_EVIDENCE`, what is wanted | |
| If `FAIL`, the blocking finding | |

No agent may complete this table. `EVC-004` stays open until a human does.
