# Section 11 — Production release UAT acceptance checklist

**Who signs this.** The business owner, or whoever they nominate. This is not a
tester's checklist: it is the business accepting that the release does what the
business needs. [Section 9](09-smoke.md) and [Section 10](10-regression.md) are
the tester's work and must be complete and green first.

**Where this runs.** Production, after the release. Everything here is either
read-only or creates one clearly-marked record that is removed afterwards.

> **Nobody on the QA side has production access.** No SSH, no production
> database, no production admin console. Every production step below is run by
> the owner or their nominee. The release itself is the owner's: Claude and the
> QA team hand over the exact command with the full 40-character SHA and the
> migration count, and never connect to production.

---

## 11.1 Before the release — gate

| #    | Gate                                                                                         | Evidence required                                                                                                                           | Met? |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| G-01 | The change is merged to `main` and its CI is green                                           | The CI run link                                                                                                                             |      |
| G-02 | Images are built for the exact SHA being released                                            | `gh workflow run build-images.yml -f sha=<full 40-character sha>` and its result                                                            |      |
| G-03 | Smoke ([09](09-smoke.md)) passed on staging                                                  | The signed-off sheet                                                                                                                        |      |
| G-04 | Regression ([10](10-regression.md)) passed on staging, with **zero P0 failures**             | The signed-off sheet                                                                                                                        |      |
| G-05 | Every change in the release has its entry in `changes/`                                      | The entry links                                                                                                                             |      |
| G-06 | `npm run check:rls` and `npm run check:permissions` pass against the migrated database       | Their output                                                                                                                                |      |
| G-07 | `npm run check:drift` reports no schema drift                                                | Its output                                                                                                                                  |      |
| G-08 | The migration count for this release is stated, and the staging-first migration gate passed  | The release log                                                                                                                             |      |
| G-09 | The backup and restore drill passed                                                          | The release log's `[backup-status]` lines: the nightly timer, its last run, the daily cadence over seven days, and the newest off-site copy |      |
| G-10 | Open P0 defects: **zero**                                                                    | The defect list                                                                                                                             |      |
| G-11 | Open P1 defects are listed and the owner has accepted each one, in writing                   | The accepted list                                                                                                                           |      |
| G-12 | Any **Needs UI Verification** item in this suite that this release touches has been resolved | The resolution notes                                                                                                                        |      |

**G-09 is read from the release log, not from a server.** The preflight's
`[backup-status]` lines are the production evidence; there is no need, and no
permission, to connect to production to see them.

If any gate is unmet, the release does not proceed. Record which, and stop.

---

## 11.2 The release itself — the owner's steps

Run by the owner, in this order, stopping at the first failure:

| #    | Step                             | Result |
| ---- | -------------------------------- | ------ |
| R-01 | Staging release                  |        |
| R-02 | The staging-first migration gate |        |
| R-03 | Backup, then the restore drill   |        |
| R-04 | Production release               |        |
| R-05 | The production smoke test        |        |

Record for the record:

|                                        |     |
| -------------------------------------- | --- |
| Released SHA (full 40 characters)      |     |
| Migration count applied                |     |
| Release date and time (with time zone) |     |
| Released by                            |     |
| Previous SHA, for a rollback           |     |

---

## 11.3 After the release — production acceptance

Each row is a business statement the owner is agreeing to. Run it in
production, as the role named.

### Can people get in and do their job?

| #    | As             | The business needs                                       | Accepted? |
| ---- | -------------- | -------------------------------------------------------- | --------- |
| A-01 | Company Admin  | I can sign in and reach my company's workspace           |           |
| A-02 | Sales Agent    | I can sign in and see my own leads                       |           |
| A-03 | Telecaller     | I can sign in and see my calling list                    |           |
| A-04 | Employee       | I can sign in and check myself in for the day            |           |
| A-05 | HR Manager     | I can sign in and see my people                          |           |
| A-06 | Finance        | I can sign in and see the money screens                  |           |
| A-07 | Platform Owner | I can reach the console and see every workspace's health |           |
| A-08 | anyone         | I can recover a forgotten password and get back in       |           |

### Is the day's work possible?

| #    | As          | The business needs                                                             | Accepted? |
| ---- | ----------- | ------------------------------------------------------------------------------ | --------- |
| A-09 | Agent       | I can add a lead and it is mine                                                |           |
| A-10 | Agent       | I can call a lead, record consent, and log the outcome                         |           |
| A-11 | Agent       | I can set a follow-up and I am reminded                                        |           |
| A-12 | Team Leader | I can see my team's day on **Daily Activity**, and the numbers are right       |           |
| A-13 | Team Leader | I can assign and reassign a lead within my team                                |           |
| A-14 | Manager     | A new enquiry from our website reaches an agent without anyone watching for it |           |
| A-15 | Agent       | I can record a site visit and the client gets a pass                           |           |
| A-16 | RE Ops      | I can record a booking against a unit, and availability changes                |           |
| A-17 | Employee    | I can apply for leave and my manager is asked                                  |           |
| A-18 | Manager     | I can approve my own people's leave and nobody else's                          |           |

### Is the money right?

| #    | As              | The business needs                                              | Accepted? |
| ---- | --------------- | --------------------------------------------------------------- | --------- |
| A-19 | Finance         | A commission figure matches what I calculate by hand            |           |
| A-20 | Finance         | A collection receipt I record **cannot** be verified by me      |           |
| A-21 | Payroll Officer | I can prepare a run and I **cannot** release it                 |           |
| A-22 | Finance         | I can release a run I did not prepare, and not one I did        |           |
| A-23 | Employee        | My payslip shows my own pay, and the figure is right            |           |
| A-24 | Finance         | A payout cannot be released without an approval by someone else |           |
| A-25 | Finance         | The WPS file downloads, or tells me exactly what is missing     |           |
| A-26 | Sales Manager   | I can propose a fee change and Finance decides it               |           |

### Is our data safe?

| #    | As             | The business needs                                                                        | Accepted? |
| ---- | -------------- | ----------------------------------------------------------------------------------------- | --------- |
| A-27 | Company Admin  | I cannot see another company's anything                                                   |           |
| A-28 | Agent          | I cannot see a colleague's leads                                                          |           |
| A-29 | Agent          | I cannot see a lead's full phone number                                                   |           |
| A-30 | Employee       | I cannot see anyone else's pay, attendance or leave                                       |           |
| A-31 | IT Admin       | I administer accounts and cannot read customers or salaries                               |           |
| A-32 | Auditor        | I can read and export everything I need and change nothing                                |           |
| A-33 | Company Admin  | Every change to money, roles and users names who did it                                   |           |
| A-34 | Company Admin  | I cannot reach the vendor's console                                                       |           |
| A-35 | anyone outside | A link we shared with a client shows the client's own information and nothing of ours     |           |
| A-36 | Platform Owner | I cannot change a customer's data without stating a reason, and they can read that reason |           |

### Is what we pay for what we get?

| #    | As             | The business needs                                                      | Accepted? |
| ---- | -------------- | ----------------------------------------------------------------------- | --------- |
| A-37 | Company Admin  | Every product on our plan works                                         |           |
| A-38 | Company Admin  | A product not on our plan tells me so, clearly, and tells me who to ask |           |
| A-39 | Company Admin  | I cannot give my own company a product we do not pay for                |           |
| A-40 | Platform Owner | Adding or removing a product takes effect within a minute               |           |
| A-41 | Platform Owner | Removing a product does **not** delete the customer's data              |           |

### Is it running?

| #    | As             | The business needs                                                             | Accepted? |
| ---- | -------------- | ------------------------------------------------------------------------------ | --------- |
| A-42 | Platform Owner | System health is green, with every queue attached                              |           |
| A-43 | Platform Owner | Background work is running: a lead created now is assigned within five minutes |           |
| A-44 | Platform Owner | AI usage and cost are visible per workspace and per user                       |           |
| A-45 | Platform Owner | Backups ran last night, and the release log shows the off-site copy            |           |

---

## 11.4 Production data hygiene

Anything created during acceptance must be marked and removed.

| #    | Check                                                                                         | Done? |
| ---- | --------------------------------------------------------------------------------------------- | ----- |
| H-01 | Every record created during acceptance is prefixed `UAT `                                     |       |
| H-02 | A list of every such record, with its reference, is attached to this sheet                    |       |
| H-03 | Each one is deleted or archived after sign-off                                                |       |
| H-04 | No test user account remains active in production                                             |       |
| H-05 | No demo-seed data exists in production (the seed refuses it — confirm it was never run there) |       |
| H-06 | No test money record remains: no UAT booking, receipt, commission or payroll run              |       |

**H-06 matters most.** A test booking left in production corrupts a real
commission report. If a money record cannot be deleted, say so explicitly and
have the owner accept it in writing.

---

## 11.5 Rollback readiness

| #    | Check                                                                                                         | Done? |
| ---- | ------------------------------------------------------------------------------------------------------------- | ----- |
| B-01 | The previous SHA is recorded above                                                                            |       |
| B-02 | Whether this release's migrations are reversible is stated, in writing                                        |       |
| B-03 | If they are not reversible, the restore-from-backup path is the rollback, and the owner has acknowledged that |       |
| B-04 | Who decides a rollback, and how they are reached, is written down                                             |       |

---

## 11.6 Outstanding items the owner is accepting

List every known issue the owner is accepting with this release. An empty table
is the ideal; a table with a P0 in it means the release should not proceed.

| #   | Item | Severity | Why it is accepted | Owner's initials |
| --- | ---- | -------- | ------------------ | ---------------- |
|     |      |          |                    |                  |

---

## 11.7 Acceptance

|                                |                |
| ------------------------------ | -------------- |
| Release SHA                    |                |
| Migration count                |                |
| Environment                    | **Production** |
| Acceptance run by              |                |
| Date and time (with time zone) |                |
| Items accepted                 | / 45           |
| Items not accepted             |                |
| P0 outstanding (must be zero)  |                |

**Statement.** _The release identified above has been exercised in production
against the acceptance items in §11.3. The gates in §11.1 were met, the data
created during acceptance has been removed per §11.4, and the outstanding items
in §11.6 are accepted._

|                    |     |
| ------------------ | --- |
| **Business owner** |     |
| Signature          |     |
| Date               |     |

---

## 11.8 If acceptance fails in production

1. **Stop.** Do not continue down the checklist.
2. Record which item failed, what you saw, and the time.
3. Decide with the owner: fix forward, or roll back to the SHA in §11.2.
4. A failure on any item in **§11.3's "Is our data safe?"** or **"Is the money
   right?"** is a roll-back decision, not a fix-forward one.
5. Raise the defect against the case in [Section 5](README.md) to
   [Section 8](08-e2e-workflows.md) that covers it, so the regression list grows
   by one row rather than the same failure recurring.
