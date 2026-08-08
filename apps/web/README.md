# LeadFlow CRM

Multi-tenant CRM and sales-execution platform. Original branding, interface, wording
and source code — no LeadSquared assets, markup, copy or trademarks are used.

**Status: Phase 0 (design) complete · Phase 1 (foundation) in progress.**

## What is in this repository right now

| Delivered                                                                                           | Path                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| System architecture, module map, navigation, job architecture, repo structure, env vars, phase plan | `docs/00-ARCHITECTURE.md`                      |
| 14 roles, full permission matrix, visibility scopes, field-level security, test obligations         | `docs/01-PERMISSIONS.md`                       |
| ER design, index strategy, partitioning, 1M-lead scaling decisions                                  | `docs/02-DATA-MODEL.md`                        |
| API conventions, error model, route surface, filter grammar, webhooks, API keys                     | `docs/03-API.md`                               |
| Automation graph format, trigger bus, execution semantics, retries, test mode                       | `docs/04-AUTOMATION-ENGINE.md`                 |
| Threat model, authn/authz, secrets, headers, rate limits, file security, audit, privacy             | `docs/05-SECURITY.md`                          |
| Demo tenant plan, distributions, edge states, 1M-row load fixture                                   | `docs/06-SEED-PLAN.md`                         |
| **Database schema — 79 models, 25 enums, 119 indexes, validates clean**                             | `prisma/schema.prisma`                         |
| Environment validation (fails at boot, not first use)                                               | `src/lib/env.ts`                               |
| Prisma tenant guard + RLS transaction helper                                                        | `src/lib/db.ts`                                |
| Permission engine, visibility resolver, field security, audit, rate limiting                        | `src/lib/security/`                            |
| Argon2id passwords, sessions, API keys                                                              | `src/lib/auth/`                                |
| API kernel (authn → limit → authz → validate → handle → mask → audit)                               | `src/lib/api/handler.ts`                       |
| Allow-listed filter compiler, keyset pagination                                                     | `src/lib/api/`                                 |
| Login route with lockout and timing equalisation                                                    | `src/app/api/v1/auth/login/route.ts`           |
| Reference module: lead list + create, implementing Workflow 1 end to end                            | `src/app/api/v1/leads/`, `src/services/leads/` |
| Tenant-isolation, scope, escalation and field-permission suites                                     | `tests/`                                       |
| **Burgundy design system** — palette rationale, type, components, a11y, dark mode                   | `docs/08-DESIGN-SYSTEM.md`                     |
| Design tokens — burgundy ramp, pearl neutrals, brass/viridian/vermillion semantics                  | `src/styles/tokens.css`                        |
| Component layer — buttons, inputs, badges, grid, tabs, timeline, alerts, skeletons                  | `src/app/globals.css`                          |
| Signature stage rail, metric cards, badges, empty states, skeletons                                 | `src/components/ui/`                           |
| Screens — sign in, app shell, home, leads grid, lead 360 detail                                     | `src/app/(auth)/`, `src/app/(app)/`            |
| Standalone design system preview (no build step)                                                    | `leadflow-design-system.html`                  |
| Docker Compose stack and hardened image                                                             | `infra/`                                       |

## What is not built yet

Phases 2–7 from `docs/00-ARCHITECTURE.md` §9. The design is fixed and the kernel is
in place; the remaining modules are implementations against it, not new decisions.

Files under `src/services/leads/` reference three helpers that are stubs pending
Phase 2: `findDuplicates`, `normalizePhone`, `nextReference`. Nothing in the kernel
depends on them.

## Running locally

Requires **Node 20.19+, 22.12+ or 24+** (Prisma 7 refuses to install below this) and
Docker Desktop running.

```bash
npm install
npm run secrets      # cross-platform; replaces `openssl rand -base64 32`
docker compose -f infra/docker-compose.yml up -d postgres redis minio
npm run db:migrate
npm run db:seed
npm run dev
```

Sign in at http://localhost:3000 with workspace `meridian` and any account the seed
prints — for example `amina.alrashid@example.com`.

To see the interface without running the stack, open `leadflow-design-system.html`
in any browser — it inlines the real token and component CSS, so it cannot drift
from the app.

Windows-specific setup errors are covered in `docs/07-TROUBLESHOOTING.md`.
`prisma generate` downloads engine binaries from `binaries.prisma.sh`; on a
locked-down network, allow that host.

## Resuming work in a new AI session

`CONTINUATION-PROMPT.md` is a paste-ready handoff: the fixed decisions, the
layering rules, current status, the definition of done, and the eight traps
already hit and fixed. Attach the archive, paste the prompt, state your goal.

## Reading order for a new engineer

1. `docs/00-ARCHITECTURE.md` §2 — the layering rules. Everything else assumes them.
2. `src/lib/api/handler.ts` — the security contract, expressed as code.
3. `src/lib/db.ts` — why a missing `tenantId` throws instead of being injected.
4. `src/services/leads/createLead.ts` — the shape every service follows.
5. `tests/tenant/isolation.spec.ts` — what "isolated" is asserted to mean.

## Three rules that are not negotiable

1. **No ambient tenant.** Every service takes a `Ctx`. A repository that reads
   `tenantId` from anywhere but its argument is a bug.
2. **The kernel is the only door.** A route that does not go through
   `route()` has skipped authentication, rate limiting, authorization, validation,
   field masking and audit. There is no partial version of that list.
3. **Hiding is not authorization.** The UI hides what the actor cannot use; the
   server decides. Both are required, and only one is a control.
