# The handover, the current position and the assistant's instructions travel with the repository

**What** — `docs/PROJECT_HANDOVER.md`, `docs/CURRENT_STATUS.md` and
`docs/AI_INSTRUCTIONS.md` are committed. They were written on 30 Oct 2026 while
the project moved to a new machine, but only ever existed in that machine's
working tree, so a clone got none of them. No PR yet.

**Why** — the project moved machines. `AI_INSTRUCTIONS.md` tells the next
session to read `CURRENT_STATUS.md` first; an untracked file cannot be read by
anyone who clones, and would have been lost with the machine that held it.
Decided by the owner.

**Where**

- `docs/PROJECT_HANDOVER.md` — the long form: overview, architecture, features,
  the decisions not to change, environment and setup, release, roadmap, and
  where work stopped.
- `docs/CURRENT_STATUS.md` — the position of the day: `main`, production, the
  one open PR, the ten owner-blocked items, the next steps.
- `docs/AI_INSTRUCTIONS.md` — the reading order and the rules a session must not
  break, kept short so it can be pasted at the start of one.
- `CLAUDE.md` — one sentence naming the two of them, so a session that starts
  where the repository tells it to start finds them.

**Behaviour** — nothing a user sees changes. A clone now carries the handover,
and `CLAUDE.md` names it, so a new session reads it instead of re-auditing the
codebase.

**Verified** — the three files are byte-identical to the originals (`cmp`), carry
no BOM and no CRLF, and name no credential value, only variable names. They are
documentation only: no code, test, schema or route is touched, so no test
behaviour changes. Their cross-references resolve from `docs/`: each names its
siblings by filename and `changes/` from the repository root.

**Left open** — these three files date themselves "30 Oct 2026" and will go
stale unless kept current, as `AI_INSTRUCTIONS.md` §3 asks. The assets they tell
the reader to copy across — the requirements tracker, the owner checklist, the
release chain and the standalone Lead Eagle app — are still outside git and were
not found on this machine.
