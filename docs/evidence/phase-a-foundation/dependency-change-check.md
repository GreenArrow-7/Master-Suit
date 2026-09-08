# Dependency change check

## Result

**VERIFIED — Phase A introduced no dependency change.** No manifest, lock
file or vendored dependency was added, removed, upgraded or edited. No
package manager was invoked during Phase A.

## Files checked

| File | Status |
|---|---|
| `apps/web/package.json` | UNCHANGED |
| `apps/web/package-lock.json` | UNCHANGED |
| `apps/mobile/package.json` | UNCHANGED |
| `apps/mobile/package-lock.json` | UNCHANGED |
| `apps/face/requirements.txt` | UNCHANGED |

Command: `git status --porcelain -- <path>` returned zero entries for each.

There is no root `package.json` and no workspace configuration; the three
applications carry independent dependency sets. VERIFIED from the repository
root listing.

## Dependency state recorded for the baseline

Recorded as observed, not changed. Runtime packages in `apps/web`:
`next` 16.2.12, `react` / `react-dom` 19.2.8, `@prisma/client` and `prisma`
7.10.0, `@prisma/adapter-pg`, `zod` 3.25.76, `bullmq` 5.81.2, `ioredis`
5.11.1, `pino` 9.14.0, `@node-rs/argon2` 2.0.2, `@aws-sdk/client-s3` 3.x,
`nodemailer` 9.0.4, `pg` 8.22.0, `ws` 8.21.3, `dotenv`, `recharts` 2.15.4,
`leaflet` 1.9.4, `@types/leaflet`. Dev: `typescript` 5.9.3, `vitest` 4.1.10,
`@playwright/test` 1.62.0, `eslint` 9.39.5, `prettier` 3.9.6, `tailwindcss`
4.3.3, `@tailwindcss/postcss`, `tsx` 4.23.1, `autocannon`, type packages.
`engines.node` is `>=22`; `package-lock.json` is `lockfileVersion: 3`.

`apps/face` pins `fastapi==0.115.6`, `uvicorn[standard]==0.34.0`,
`onnxruntime==1.27.0`, `opencv-python-headless==4.11.0.86`, `numpy==2.2.1`.

`apps/mobile` declares `@capacitor/core`, `@capacitor/android`,
`@capacitor/ios`, `@capacitor/push-notifications`.

**Caveat on presence versus use.** The list above is what the manifests
declare. Phase A did not audit whether every declared package is actually
imported at runtime; package presence is not evidence of active usage.
Where a Phase A document asserts that a library is in use, it cites the
importing module.

## Vulnerability posture

`npm audit --omit=dev --audit-level=high` runs as a CI gate
(`.github/workflows/ci.yml`). Phase A did not execute it and makes no claim
about the current advisory state. No Python dependency audit exists in CI —
recorded as GAP-SEC-04 and already noted in `docs/DEPENDENCY-SECURITY.md`.

## Evidence Sources

E2: `apps/web/package.json`, `apps/web/package-lock.json`,
`apps/mobile/package.json`, `apps/face/requirements.txt`,
`.github/workflows/ci.yml`.
E1: `git status --porcelain` output at commit `f16ed67`.
