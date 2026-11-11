# YOUHAN ONE — Role-Based Manual QA & UAT Test Suite

|                  |                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspected**    | 6 November 2026                                                                                                                                                                 |
| **Branch**       | `claude/ponytail-lite-9d4d9a`                                                                                                                                                   |
| **Commit**       | `1b8226f9069907b6da84e1f868837a2ba9e067e3`                                                                                                                                      |
| **Base**         | `main`                                                                                                                                                                          |
| **Written from** | The repository at that commit: Prisma schema, seeded role matrix, permission catalogue, navigation model, page and API route files, React components, services and worker code. |

> **This describes the repository, not the deployed system.** Nobody on this
> side has production access — no SSH, no production database, no admin console.
> Every expected result below is what the code at the commit above says should
> happen. Where a label or screen could not be read off the code with
> certainty it is marked **Needs UI Verification** and the tester must confirm
> it against the running application before recording a Fail.

## Who this is for

A manual tester with no prior knowledge of YOUHAN ONE. Open the section for the
role you are testing as, sign in with the account the section names, follow the
steps, and record Pass / Fail / Blocked against the expected result. You should
not have to ask a developer how to reach a screen.

## The files

| File                                                     | Section | What it holds                                                                            |
| -------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| [01-inventory.md](01-inventory.md)                       | 1       | Every module, screen and workflow found in the code, with implementation status          |
| [02-roles-and-personas.md](02-roles-and-personas.md)     | 2       | The 25 seeded roles, the permission model, and how the 17 testing personas map onto them |
| [03-access-matrix.md](03-access-matrix.md)               | 3       | Role × functionality access matrix, and the scope each grant carries                     |
| [04-environment-and-data.md](04-environment-and-data.md) | 4       | Test environment, the accounts to create, and sample data                                |
| [05a-platform.md](05a-platform.md)                       | 5       | Platform Owner / Platform Staff test cases                                               |
| [05b-administration.md](05b-administration.md)           | 5       | Company Admin test cases (users, roles, settings, integrations, audit)                   |
| [05c-sales.md](05c-sales.md)                             | 5       | Sales CRM test cases (manager, team leader, agent, telecaller, QA)                       |
| [05d-people.md](05d-people.md)                           | 5       | People / HRMS test cases (HR, payroll, manager, employee)                                |
| [05e-real-estate.md](05e-real-estate.md)                 | 5       | Real Estate test cases (inventory, visits, bookings, collections, commissions, events)   |
| [05f-lead-eagle.md](05f-lead-eagle.md)                   | 5       | Lead Eagle test cases, including its own sign-in door                                    |
| [05g-public.md](05g-public.md)                           | 5       | Public Visitor test cases (forms, QR capture, landing pages, shares, RSVP, testimonials) |
| [06-negative-boundary.md](06-negative-boundary.md)       | 6       | Module-wise negative, boundary and failure cases                                         |
| [07-tenancy-authz.md](07-tenancy-authz.md)               | 7       | Multi-tenant isolation and authorization, UI and direct API                              |
| [08-e2e-workflows.md](08-e2e-workflows.md)               | 8       | The eight cross-role end-to-end business workflows                                       |
| [09-smoke.md](09-smoke.md)                               | 9       | Smoke checklist                                                                          |
| [10-regression.md](10-regression.md)                     | 10      | Regression checklist                                                                     |
| [11-uat-acceptance.md](11-uat-acceptance.md)             | 11      | Production release UAT acceptance checklist                                              |
| [12-coverage-and-gaps.md](12-coverage-and-gaps.md)       | 12      | Coverage analysis, what is not covered, and what needs verification                      |
| `YOUHAN-ONE-Test-Matrix.xlsx`                            | —       | One row per test case, with execution and defect-tracking columns                        |

Two documents already in this folder are **not** part of this suite and are left
as they are: [END-TO-END-ACCEPTANCE.md](END-TO-END-ACCEPTANCE.md), the owner's
own earlier acceptance record, and
[ENV-CREDENTIAL-EXPOSURE-2026-11-05.md](ENV-CREDENTIAL-EXPOSURE-2026-11-05.md),
a security incident note. Read the first for what the owner has already
accepted, so this suite's results can be compared against it.

## Test case ID scheme

`<MODULE>-<AREA>-<NNN>`, unique across the whole suite and stable: never renumber.

| Prefix  | Module                                                 |
| ------- | ------------------------------------------------------ |
| `PLAT`  | Platform administration                                |
| `ADMIN` | Company administration (workspace-level configuration) |
| `SALES` | Sales CRM                                              |
| `HR`    | People / HRMS                                          |
| `RE`    | Real Estate                                            |
| `LE`    | Lead Eagle                                             |
| `PUB`   | Public (unauthenticated)                               |
| `TEN`   | Multi-tenant isolation and authorization               |
| `E2E`   | End-to-end cross-role workflow                         |
| `NEG`   | Negative / boundary / failure                          |

Priorities: **P0** blocks release (security, tenancy, money, payroll, login),
**P1** a core business workflow, **P2** everything else.

## Rules for the tester

1. **Do not mark a case Passed unless you executed it.** Blocked is a real,
   acceptable outcome; so is "could not reach the screen".
2. **Page availability is not permission.** A screen that loads and then refuses
   an action is working as designed in several places here; the expected result
   says which.
3. **A hidden menu item is not a restriction.** Navigation hiding is presentation
   only — the server still refuses. Every negative authorization case that says
   "also check by URL" must be checked by typing the URL, not only by looking at
   the menu.
4. **Record the evidence the case asks for.** A failed authorization case needs
   the HTTP status, not just a screenshot of an error.
5. **Report, do not fix.** Do not change roles, permissions, settings or data
   outside what a case tells you to create.
