# One architecture document, read off the code rather than the older docs

**What.** `docs/ARCHITECTURE.md`, with its 16 Mermaid diagrams as editable
sources in `docs/architecture/`. No application code touched.

**Why.** The owner asked for a current, simple architecture document for both a
business owner and a new developer, based on the implementation and not on
documentation that may have drifted. `changes/PROJECT.md` is the project's
working memory and assumes a reader who already knows the product; the root
`README.md` still describes the old "Master SaaS" layout; `docs/` has 40-odd
topic files and no single map.

**Where**

- `docs/ARCHITECTURE.md` — plain-English overview, then overview, diagrams,
  features, workflows, data, methodology, risks, glossary, feature-to-component
  table, and a "where to look next" index. Every claim names the file it came
  from.
- `docs/architecture/*.mmd` — one diagram per file; `README.md` there maps each
  to the section that shows it.

**Behaviour.** Documentation only. Nothing in `apps/` changed.

**Verified.** Branch and commit recorded in the document's header
(`claude/ponytail-lite-9d4d9a`, `1b8226f9`). Counts taken from this tree: 231
models, 126 migrations, 257 API route files, 249 pages, 11 queues, 47
`ENABLE ROW LEVEL SECURITY` statements, 12 schedules. All 16 diagrams parse
**and render** under Mermaid 11.4.1 (checked in a browser; two sequence-diagram
lines had to lose a `;`, which Mermaid reads as a statement separator).
Prettier clean.

**Left open.** Production is not verified from here, and the document says so in
its header and in §7 rather than restating the release record as fact. Two
contradictions it surfaces and does not resolve: `apps/mobile/capacitor.config.js`
calls `server.url` a development proof of concept that must not be submitted to
a store, while `docs/CURRENT_STATUS.md` records an iOS submission awaiting
review; and `changes/PROJECT.md` carries duplicated paragraphs and two
conflicting "Attendance is not HR" bullets. `PROJECT.md` was left unchanged —
nothing in this change made it wrong.
