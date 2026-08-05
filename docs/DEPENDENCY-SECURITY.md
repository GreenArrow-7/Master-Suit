# Dependency security report — 2026-08-03

The Sales/platform application was upgraded to Next.js 16.2.12 and Vitest 4.1.10.
PostCSS and Sharp are constrained to patched releases through package overrides.
`npm audit` reports zero production and zero development advisories after the
upgrade. The production build passes on this dependency set.

Python dependencies remain pinned in `apps/hrms/requirements.txt`. A networked
Python advisory scan is still required in CI; absence of that scan is recorded as
residual risk rather than interpreted as absence of vulnerabilities.
