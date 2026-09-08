# B2 limitations carried forward

**Phase:** B3 · **Date:** 2026-09-07

The phase brief listed seven limitations from B2 and instructed that none be
silently closed. Each is answered below with what B3 actually did about it,
which in most cases is nothing.

## 1. The CI workflow has never run on GitHub

**Status: open, unchanged.**

`.github/workflows/sdd-validate.yml` was authored in B2 and remains untracked
and unpushed. Whether it succeeds on a Linux runner is
`UNKNOWN — requires verification`.

B3 did not push, did not commit, and did not modify the file. The `gh`
command line is unauthenticated in this environment, so no run history could
be read, and none was guessed at.

## 2. Branch protection and required status checks are externally unverified

**Status: open, unchanged.**

Whether the check is required on merge is a repository setting on GitHub. It
cannot be established from inside a working tree, and B3 had no authenticated
access to look.

## 3. Approval records prove presence, not human authenticity

**Status: open, unchanged, and now more visible.**

B3 adds no authentication and depends on none. It does add a related
limitation of its own: `actorId` on a session or review record is likewise a
self-declared label with no binding.

Both are recorded in
`docs/evidence/phase-b3-agent-integration/known-limitations.md`. The honest
statement is that this system records claims and checks their consistency. It
does not authenticate the claimant.

## 4. The validator checks structure, not engineering quality

**Status: open, and the surface is now larger.**

The seventeen new rules check process correctness: was a session authorised,
was scope respected, does a review exist, is the reviewer distinct. They say
nothing about whether the code is good, the review thoughtful or the test
meaningful.

This is deliberate and documented in `docs/sdd/ENFORCEMENT_STANDARD.md`. A
tool that scored quality would be trusted for a judgement it cannot make. The
risk B3 adds is a reader mistaking a green process check for a quality
verdict, which is why `docs/sdd/AGENT_EXECUTION_RECORD.md` says the word
"accepted" appears nowhere in the session vocabulary.

## 5. The workflow has not been exercised on a real product feature

**Status: open by instruction.**

B3 is explicitly not a product pilot. `SPEC-0002` governs process tooling
only, and no application file was touched. Whether the process helps or
obstructs a real feature is unknown, and B3 makes no claim about it.

## 6. Code-without-spec remains advisory

**Status: open by instruction.**

`SDD-V041` remains `WARNING`. The phase brief instructed directly that it not
be promoted during B3, and it was not. See
`docs/evidence/phase-b3-agent-integration/transition-policy-audit.md`.

## 7. Rules without dedicated negative fixtures remain tracked

**Status: narrowed for B3 rules, unchanged for B2 rules.**

All seventeen new rules have a dedicated negative fixture; `SDD-V051` has two,
because it enforces two distinct comparisons. The mapping is in
`docs/evidence/phase-b3-agent-integration/invalid-fixture-results.md`.

The B2 position on B2 rules is exactly as B2 left it. B3 added no fixture for
any rule below `SDD-V042`.
