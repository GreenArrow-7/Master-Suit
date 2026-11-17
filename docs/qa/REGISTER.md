# Pending-work and CI register

**As at 11 November 2026.** Branch `claude/ponytail-lite-9d4d9a`, PR
[#239](https://github.com/GreenArrow-7/Master-Suit/pull/239).

Separated throughout: **verified here** (I ran it and read the output) from
**not reachable from here** (production database and deployment host).

## The baseline, read not assumed

|                                      |                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Local HEAD                           | `7c05aa7aec9ae815eb76a0a970af9613e5afa901`                                                                      |
| `origin/claude/ponytail-lite-9d4d9a` | the same                                                                                                        |
| PR #239 head                         | the same                                                                                                        |
| Working tree                         | clean                                                                                                           |
| Deployed `BUILD_COMMIT`              | `83d9a85eeb12` — from the operator's own `docker exec` output                                                   |
| Deployed images                      | `web sha256:54204439ba54…`, `worker sha256:13ad1ac795c3…` — these match the manifests the 11 Nov deploy printed |

### CI, reconciled rather than inherited

**This is the correction that matters.** A green ancestor is not evidence for a
later head, and most of this branch's runs were cancelled by the next push.

| SHA        | Run                             | Contains                                     |
| ---------- | ------------------------------- | -------------------------------------------- |
| `7c05aa7a` | **in progress**                 | grant-ceiling characterisation               |
| `34f969f8` | **cancelled**                   | the assignment-scope fix                     |
| `cccf6c77` | cancelled                       | role inventory                               |
| `9ffda99a` | cancelled                       | duplicate-PATCH correction                   |
| `6ca4e589` | **success**                     | lead contact rule, release gate, WebKit work |
| `4f0f7f31` | failure — `npm ci` `ECONNRESET` | infrastructure, not code                     |

**The assignment-scope fix has never passed CI.** Its only run was cancelled.
`6ca4e589` is green and is an _ancestor_ that does not contain it. Nothing on
this branch after `6ca4e589` has a green run yet.

## Register

| Item                              | SHA                   | Implemented                         | Tested                                        | Deployed       | Live-verified | Blocker                            |
| --------------------------------- | --------------------- | ----------------------------------- | --------------------------------------------- | -------------- | ------------- | ---------------------------------- |
| **iPhone blank screen**           | `6ca4e589`            | partial — one measured race removed | yes, WebKit + production bundle, both timings | **`83d9a85e`** | **no**        | the device. Not reproducible here  |
| Employee "0 items"                | `2fe0645d`            | yes                                 | yes                                           | **`83d9a85e`** | **no**        | device retest                      |
| Teams / Allocation pickers        | `6fe1da3b`            | yes                                 | yes                                           | **`83d9a85e`** | **no**        | device retest                      |
| Reporting-manager eligibility     | `2fe0645d`+`1afbcb17` | yes                                 | 7 cases, both doors                           | **`83d9a85e`** | **no**        | device retest                      |
| Department / designation          | `2fe0645d`            | yes                                 | HR journey                                    | **`83d9a85e`** | **no**        | device retest                      |
| Branch administration             | `1afbcb17`            | yes                                 | 5 cases + live dropdown                       | **`83d9a85e`** | **no**        | device retest                      |
| Source / sub-source               | `2fe0645d`            | yes                                 | yes                                           | **`83d9a85e`** | **no**        | device retest                      |
| Lead validation                   | `0fdd34d0`            | yes                                 | 10 cases; 14 impacted recovered               | **no**         | no            | CI, then release                   |
| Release-gate repair               | `0fdd34d0`            | yes                                 | `bash -n`, refusal paths                      | **no**         | no            | same release                       |
| **Assignment scope fails closed** | `34f969f8`            | yes                                 | 10 cases, 6 red before                        | **no**         | no            | **never had a green CI run**       |
| **Per-permission grant ceiling**  | this change           | yes                                 | 8 cases, 5 red before                         | **no**         | no            | CI                                 |
| Nine `review-demo` roles          | —                     | queries written                     | —                                             | —              | —             | production access                  |
| Product entitlement enforcement   | —                     | **not started**                     | —                                             | —              | —             | —                                  |
| Commission self-approval          | —                     | **not started**                     | —                                             | —              | —             | —                                  |
| Six-role matrix                   | —                     | **not started**                     | —                                             | —              | —             | the ceiling decision, now answered |
| Default provisioning              | —                     | **not started**                     | —                                             | —              | —             | matrix                             |

**No row is complete because it has a commit.** Implementation, deployment and
device verification are three columns on purpose.

## Not reachable from here

- The production database — every inventory is a query for the operator.
- The deployment host — releases are the owner's, by the project's own rule.
- A physical iPhone, and a Mac for Safari Web Inspector.
