# RC-3 — POSIX platform limitation, disposition packet

| Field | Value |
|---|---|
| Packet version | **2 — updated after the seed-parity rework** |
| Finding | `SPEC-0004/CONV-002` |
| Specification | `SPEC-0004`, risk `R2` |
| Subject-matter role | **QA / Release Engineering** — owns *test adequacy* (`docs/sdd/HUMAN_APPROVAL_GATES.md`, roles table) |
| Deciding actor | **the Qualified Human Reviewer discharging gate 6**, per `EVC-017` |
| Date | 2026-09-08 |
| Status | `OPEN` — **not accepted by me, and not acceptable by me** |

## Who decides, and how that was determined

Read from the governing documents rather than inferred:

1. `HUMAN_APPROVAL_GATES.md` roles table — **QA / Release Engineering** owns
   *"test adequacy, convergence verdict, release readiness"*. Test adequacy is
   exactly what this finding is about, so QA / Release Engineering is the role
   that owns the subject matter.
2. `RISK_TO_PROCESS_MATRIX.md`, R2 row — there is **no separate QA sign-off
   gate at R2**. The gates required at R2 are one human code review and a
   convergence verdict.
3. `HUMAN_APPROVAL_GATES.md` gate 6, as amended by `EVC-017` — for an
   **AI-authored** `R0–R2` specification, convergence acceptance is exercised
   by a **Qualified Human Reviewer**, who *"must understand the verdict and
   every `ACCEPTED_RISK` finding"*.

**Therefore:** this finding is dispositioned by the Qualified Human Reviewer as
part of gate 6, with QA / Release Engineering as the role that owns the
question. If one person holds both, that is permitted — the two decisions are
still recorded separately.

**No new gate is invented for this**, and no generic "human" is named where the
standard names a role.

## The finding

Two assertions in `apps/web/tests/unit/observability.spec.ts` do not execute on
this workstation:

```js
const POSIX_MODES = process.platform !== 'win32';
const itPosix = POSIX_MODES ? it : it.skip;
```

```js
itPosix('writes the relay password into a file readable by nobody else', () => {
  expect(statSync(secret).mode & 0o777).toBe(0o600);
});
```

Exactly two cases, and no others:

| # | Suite | Test name | Line |
|---|---|---|---|
| 1 | `alertmanager-entrypoint.sh` | *writes the relay password into a file readable by nobody else* | 155 |
| 2 | `prometheus-entrypoint.sh` | *writes the scrape token into a file readable by nobody else* | 229 |

Both assert `statSync(f).mode & 0o777 === 0o600` — readable by the owner and
nobody else — on a file holding a secret.

Measured, not assumed. `npx vitest run tests/unit/observability.spec.ts
tests/permission/engagement-modules.spec.ts` on 2026-09-08 reports **21 passed,
2 skipped**, and the two skipped are exactly the rows above.

## What still executes on Windows

**The security property was split, not removed.** Each of the two invariants
has a portable half that runs everywhere and a POSIX half that does not:

| Half | Asserts | Runs on Windows |
|---|---|---|
| portable | the secret is written to a **file**, not inlined | **yes** |
| portable | the config references `smtp_auth_password_file:` | **yes** |
| portable | the rendered YAML does **not** contain the secret | **yes** |
| portable | the file holds exactly the expected bytes, no trailing newline | **yes** |
| POSIX | the file's mode is exactly `0o600` | no |

So on Windows the assertions that a secret is not leaked into a config file
still run. What does not run is the check on the file's permission bits.

## What changed, precisely

| | Before | After |
|---|---|---|
| Assertion text | `expect(statSync(f).mode & 0o777).toBe(0o600)` | **identical** |
| Where it runs | everywhere; **failed** on Windows | POSIX only |
| Where it is skipped | nowhere | Windows, with a stated reason |
| What it demands where it runs | exactly `0o600` | **exactly `0o600`** |

**The requirement was not relaxed.** `0o777` on Windows cannot equal `0o600`
however correct the entrypoint script is — NTFS does not carry POSIX mode bits,
and Node synthesises a value. The old test could not pass on Windows for any
implementation, correct or not, so it was measuring the platform rather than
the code.

## Why this is a limitation and not a fix

The two assertions now execute **only** where the platform supports them. On
this workstation they are skipped, so a regression in the file mode of a secret
would be invisible **here**.

`EVC-014` records that CI runs `ubuntu-latest`, where they do execute. That
record is explicit that its own status is **`DOCUMENTED`, not measured**:

> CI's own recent result could not be read (`gh` is not authenticated in this
> environment).
>
> Confidence: High (cause) · **Medium (CI status)**

**So the claim "they run in CI" is a documented expectation, not an observed
fact from inside this workstream.** That is the honest shape of the gap, and it
is why this is put to a human rather than closed.

## Suite-wide skip accounting

After the seed-parity rework the whole product suite reports **2 skipped**, and
both are the rows above. The third skip — `tests/permission/engagement-modules.spec.ts`
→ *"grants each role exactly what it already had on leads — never more"* — was
**not** a platform limitation. It skipped because the local test database was
unseeded while CI seeds; `db:test:prepare` now seeds, and it executes and
passes locally. **It is not part of this disposition.**

## The three options

### A — accept as a platform limitation

Record it as an accepted risk with a named owner. The assertion is unchanged
and still binding where it runs.

- **For:** the requirement is intact; the alternative on Windows is a test that
  can never pass; the deployment target is Linux.
- **Against:** it rests on `EVC-014`'s CI claim, which is documented rather
  than measured.

### B — accept, conditional on a measured CI run

As A, plus: read one `verify` run on `main` and confirm both cases **executed**
rather than skipped, then downgrade `EVC-014` from `PARTIALLY RESOLVED`.

- **For:** converts the one unmeasured link into evidence. Costs one CI log
  read.
- **Against:** needs `gh` authentication, which is not available in this
  environment.
- **Note:** a skipped test and a passing test look identical in a summary
  count. The confirmation must be that the two cases **ran**, not that the file
  passed.

### C — reject the gating and require another mechanism

Assert the property some other way on Windows.

- **Against:** there is no faithful equivalent. Checking an ACL is a different
  assertion about a different mechanism, and the risk it would carry is a false
  sense of coverage rather than no coverage.

## Recommendation

**B.** A is defensible and probably where this lands, but B costs one log read
and removes the only unmeasured step in the chain. The difference between
*"documented as running in CI"* and *"observed running in CI"* is the whole
substance of this finding.

**This is a recommendation. It is not a decision, and it is not recorded as
one.**

## What must not happen

- The assertion must not be weakened to run on Windows. `0o600` means `0o600`.
- The cases must not be deleted to remove the finding.
- `EVC-014` must not be marked `RESOLVED` on the strength of this packet. Only
  a measured CI run closes it.
- No agent may record this disposition. `AGENTS.md` forbids it, and nothing
  here should be read as having done so.

## What is being asked for

One decision — **A, B or C** — recorded against `CONV-002`, by the Qualified
Human Reviewer discharging gate 6, with QA / Release Engineering owning the
question.

If **B**, the follow-up action is: read the latest `verify` run on `main` and
confirm both `itPosix` cases executed.
