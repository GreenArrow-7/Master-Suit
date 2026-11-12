# An evidence-based map of the product, in docs/architecture/

**What.** Six documents under `docs/architecture/` mapping the whole product
from source, plus the Graphify report they were built from. No PR yet; on branch
`docs/architecture-map`.

- `PRODUCT-OVERVIEW.md` — what YOUHAN ONE does and how the modules connect.
- `SYSTEM-MAP.md` — Mermaid diagrams: processes and stores, a request through
  the kernel, tenant isolation, event → job → effect, route groups, the five key
  journeys, and how to regenerate the graph.
- `MODULE-INVENTORY.md` — per module: features, pages, APIs, services, models,
  integrations, tests, implementation status.
- `ACCESS-CONTROL-MAP.md` — platform versus workspace roles, multi-role
  behaviour, the scope ladder, field security, subscription enforcement, and the
  monitoring path.
- `CHANGE-IMPACT-GUIDE.md` — what else a change reaches, and the tests to run,
  for lead assignment, the lead list, roles, payroll, AI, the kernel, money,
  attendance and the queues.
- `FINDINGS.md` — 39 findings with severity, `path:line`, confidence and a next
  step.
- `GRAPH_REPORT.md` — Graphify's own output for this commit.

**Why.** Asked for: an evidence-based map of the modules, journeys, APIs,
services, models, integrations and access controls, useful for planning future
changes. `docs/product/CURRENT-CODE-MAP.md` answered part of this but is pinned
to `f16ed677` on another branch and says "None has been fixed", which is no
longer true — two of its concerns were re-checked here and one is fixed. These
documents are stamped with the commit they describe so the same thing cannot
happen silently.

**Where**

- `docs/architecture/*.md` — the six documents and the graph report (new).
- `.gitignore` — ignores `graphify-out/`; `graph.json` is ~14 MB and the cache
  holds an entry per source file.
- Nothing under `apps/` was touched. No source, permission, schema or
  configuration change.

**Behaviour.** Nothing changes for users or operators. Documentation only.

**Verified.** No automated check covers these files: the repo's only
documentation-adjacent gate is `prettier --check .`, which runs from `apps/web`
(there is no root `package.json`), so repo-root `docs/` is outside its scope —
and `node_modules` was absent, so it could not have been run anyway. Checked by
hand instead: every Mermaid fence opens and closes, every table is aligned, and
every internal link resolves to a file in the same directory. Every factual
claim carries a `path:line` read at
`babbaa06db5620590e1308a6a1fa94054b304992`; findings are marked **confirmed**
(code read during this analysis), **reported** (cited by a review pass, not
re-read) or **suspected**. Nothing was executed, so there is no measurement
anywhere in them.

**Left open.**

- `FINDINGS.md` F-01 is the one to act on first: `main` is four commits ahead of
  the recorded production release, and one of them fixes a total ONE AI outage.
- F-12, F-13 and F-14 must ship as **one** change. Fixing the first alone moves
  the contact-masking gap into the assistant's phone-suffix filter, which is a
  faster oracle than the one it closes.
- `changes/PROJECT.md` has five duplicated or broken blocks (F-36), including
  "Attendance is not HR" twice with different content. Not fixed here — this
  change does not own that file's content.
- `docs/product/CURRENT-CODE-MAP.md` needs a header pointing here, or re-dating
  (F-37).
- The 128 `.sql` migrations are absent from the graph; parsing them needs the
  optional `tree_sitter_sql` extra, deliberately not installed. Index claims come
  from `prisma/schema.prisma`.
- Graphify ran entirely locally — AST only, 0 input and 0 output tokens, nothing
  uploaded. A semantic pass over the 246 documents and 96 images was not run.
