# Three handover documents travel with the repository, so a new machine starts informed

**What.** `PROJECT_HANDOVER.md`, `CURRENT_STATUS.md` and `AI_INSTRUCTIONS.md`.
They were added at the repository root and now live in `docs/`, where the
[handover entry of the same day](2026-10-30-handover-docs.md) put them and where
`CLAUDE.md` points. The owner is moving the project folder to another computer
and continuing with an AI assistant there; these let it start from the
documented state instead of re-scanning 231 models, 256 routes and 395 specs.

**Why.** The owner asked for a handover package (30 Oct). `changes/PROJECT.md`
already holds the architecture and `docs/product/HANDOVER-GUIDE.md` the _user_
handover, but nothing recorded where development stopped, what is unfinished but
written, what lives outside the repository, or how an assistant should behave
here. The three files add only that, and point at `changes/` for the rest rather
than copying it.

**Where.**

- `PROJECT_HANDOVER.md` — overview, architecture and folder map, features by
  state, the five contracts every change obeys, decisions not to revisit,
  environment and commands (variable names only, no values), roadmap, the exact
  stopping point, and what is not in git.
- `CURRENT_STATUS.md` — one page: `main` `4861a72f`, production `4861a72f` with
  126 migrations, 288/298 requirements (96.6 %), PR #224 draft, the 10
  owner-blocked items, the next steps.
- `AI_INSTRUCTIONS.md` — read order, the rules that have broken the build
  before, the `changes/` obligation, verification commands, git and release
  discipline, and what not to redo.

**Behaviour.** None. Documentation only; no application file is touched.

**Verified.** Every cited path opened in this checkout; counts (231 models, 126
migrations, 256 route files, 249 pages, 395 specs, 118 change entries, 11
queues, 82 `.env.example` keys) read from the tree; `main`, production and PR
state read from git and GitHub. Statements that could not be verified are marked
in the document.

**Left open.** Two defects the handover records rather than fixes, because the
owner asked for documentation without code changes: `changes/PROJECT.md`'s header
still reads "Updated 2026-10-11 … f9c0c1a … 101 migrations" (the body is
current), and four paragraphs in it are duplicated by an earlier merge
resolution. The root `README.md` still describes the older "Master SaaS" layout.
