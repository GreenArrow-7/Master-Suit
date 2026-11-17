# An exact list of what the end-to-end suite left in a workspace, before anything is deleted

## What

`apps/web/scripts/e2e-leak-inventory.mjs`. **Read-only. It deletes nothing and
has no `--apply`.**

```
node scripts/e2e-leak-inventory.mjs --slug <workspace-slug>
```

It reports every row the three browser specs created inside the workspace
`E2E_DEMO_SLUG` named — roles, accounts, employee profiles, leads, a work
location and an opportunity — with each row's id, the date it was created and
the spec that made it.

## Why

The fix on 9 November stopped the leak; it did not remove what was already
there. Those rows are in a workspace somebody uses: the field report was a Role
picker offering "Journey Rep mu8vfn6x" and a Reporting-manager picker offering
accounts from runs nobody remembers. A role in a live workspace is a grantable
role, which makes this a role boundary nobody chose.

The brief was explicit: no bulk delete by name, an exact inventory first. So the
first deliverable is a list, and it is the only deliverable — the script has no
way to remove anything, which is the point rather than an omission.

## How a row is identified

By the **generator**, never by "looks like a test". Each entry is the literal
template from the spec that produced it, with the run tag written as what
`Date.now().toString(36)` actually produces — eight lowercase base-36
characters — and anchored at both ends.

Two filters, both needed. The database narrows on the literal prefix, so this
never reads a whole lead table; the anchored pattern then decides. The prefix
alone would take `Journey Lead of the Year`; the pattern alone would cost a
table scan.

A row that does not match stays off the list. A list that is slightly short is
recoverable; one that names a customer's own role is not.

## Where

- `apps/web/scripts/e2e-leak-inventory.mjs` — new.

Templates recovered from the specs as they were at `2fe0645d^`, which is what
actually ran: `seller_<run>`, `journey_rep_<run>`, `Journey HQ <run>`,
`journey-rep-<run>@example.com`, `JR-<run>`, `Journey Lead <run>-<i>`,
`Journey deal <run>`, `scope_<run>`, `scope-<tag>-<run>@example.com`,
`SC-<tag>-<run>`, `Scope Lead <run>`, `dtw-<run>@example.com`, `DTW-<run>`,
`Daily WF Lead <run>-<i>`.

## Behaviour

No change to the application.

## Verified

Against a seeded workspace in the local test database:

- a clean workspace reports **0**;
- with `journey_rep_mu8vfn6x` planted beside the decoys `journey_rep_dubai` and
  `Seller 3` — both sharing a prefix, neither matching the template — it
  reported **exactly one** row, with its id and spec, and ignored both decoys;
- after removing the planted rows it reports **0** again.

## Left open

The deletion itself, deliberately. Whoever runs the list has to confirm each row
and remove it by id; a role still granted to somebody needs that grant moved
first, which no script should decide. And this covers the three specs known to
have written into a shared workspace — if others were ever pointed at one, their
templates need adding.
