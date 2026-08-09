# M9 — Commissions & money

## The gate this module was built around

The spec says:

> M9 requires the commission slab rules to be documented and signed off by
> finance **before any code is written**.

No slab rules were supplied, so the module was built the only way that honours
that constraint without stalling: **the engine contains no rates.** There is no
default percentage, no fallback slab, no seeded example. `applySlab` is pure
arithmetic over bands it is handed, and `accrueCommission` refuses outright when
no signed slab matches:

```
{ code: 'no_signed_slab' }
```

A slab becomes usable only when a row exists **and** somebody other than its
drafter has signed it. Until finance does that, a fresh workspace accrues
nothing at all rather than guessing a number and quietly being wrong. When the
rules do arrive, they are entered as data — no code change, no deployment.

## The pieces

| Thing | Where | What it is |
|---|---|---|
| Band arithmetic | `src/services/money/slabs.ts` | Pure `Decimal` maths. No I/O, no rates. |
| The ledger | `src/services/money/commissions.ts` | Accrual, stage changes, clawback, reconciliation. |
| Payout runs | `src/services/money/payouts.ts` | Gather → approve → release. The only route to `PAID`. |
| Slab admin | `/api/v1/commission-slabs` | Draft (`POST`), sign off (`PATCH`). |
| Bookings | `/api/v1/bookings` | The sale a commission hangs off: create, confirm, collect, cancel. |
| Commissions | `/api/v1/commissions` | Accrue, claw back, move a stage. |
| Reconciliation | `/api/v1/commissions/reconciliation` | Earned vs reversed for a period. |
| Payouts | `/api/v1/payouts` | Build a run, approve, pay, cancel; `?payoutId=` returns a statement. |
| UI | `/{workspace}/sales/commissions` and `.../commissions/slabs` | Ledger, runs, and the rules. |

## Two structural rules

**A commission freezes the rule that made it.** The rate, mode, basis, slab
version and a band-by-band breakdown are copied onto the row at accrual and
never re-read. Renegotiating in March must not restate February, and a payment
already made must stay reconcilable against the number that produced it. A new
rate is therefore a **new slab version**, never an edit — signing v2 closes v1
by setting its `effectiveTo`.

**Nothing is deleted and nothing is edited backwards.** A cancelled sale
produces a reversal row carrying a negative amount and a `reversesId` pointing
at the original; the original is left exactly as it was. Enforced in the
database, not just in code:

```sql
CHECK (
  (status = 'CLAWED_BACK' AND "reversesId" IS NOT NULL AND amount <= 0)
  OR (status <> 'CLAWED_BACK' AND "reversesId" IS NULL AND amount >= 0)
)
```

plus a partial unique index on `reversesId` so a row cannot be reversed twice.

## Slab modes

- **PROGRESSIVE** — each band's rate applies only to the slice inside it. Every
  slice is rounded as it is taken, so the stored breakdown sums exactly to the
  stored total. A statement whose lines do not add up is a dispute.
- **FLAT** — the band containing the whole amount sets one rate for all of it.
- **FIXED** — the band pays a flat sum; `effectiveRatePct` is null.

Bands are validated on the way in *and* on the way out by the same function:
they must start at zero, not overlap, and leave no gap. A slab with a hole in it
is a payroll incident discovered on payday. Boundaries are lower-inclusive,
upper-exclusive — exactly 1,000,000 belongs to the band that starts there.

## The booking

A sale starts as a `DRAFT` and accrues nothing. `PATCH /api/v1/bookings` moves
it: `CONFIRM` makes it real enough to accrue against, `COLLECT` records that the
client's money arrived, `CANCEL` closes it. Cancelling **refuses** while live
commissions hang off the booking — orphaning them would leave amounts owed
against a sale that no longer exists, so they have to be clawed back first,
which is a deliberate act with a reason attached.

## The lifecycle

```
ACCRUED ──▶ CONFIRMED ──▶ COLLECTED ──▶ PAID
                                          ▲
   (any stage) ──▶ reversal row ─ CLAWED_BACK (terminal, never a transition)
```

Forward one step at a time, no jumps.

- `CONFIRMED` needs `commissions:APPROVE`.
- `COLLECTED` is refused unless the booking has a `collectedAt` — you cannot pay
  out of money the client has not sent.
- `PAID` is **not reachable** one commission at a time. It is set by a payout
  run, so every paid amount is attached to the transfer that settled it.

## Payout runs

A run gathers one person's `COLLECTED` commissions for a period, plus any
clawbacks not yet netted off, into a single statement.

- **One currency per run.** Netting dirhams against rupees produces a number
  nobody can transfer.
- **A run may be negative.** Someone paid last month and clawed back this month
  owes money back; filtering negatives out would quietly write the debt off. A
  clawback taken *before* payment simply cancels its original and nets to zero.
- **Whoever builds a run cannot approve it.** The one control that stops a
  single person moving money to themselves end to end. `payouts:APPROVE` is
  required on top.
- **Cancelling releases the lines** back to the pool with `payoutId` set to
  null, so a cancelled run never strands somebody's earnings.
- Only one DRAFT or APPROVED run per person at a time.

`Payout.totalAmount` is always **recomputed** from the attached rows, never
incremented in place, so it cannot drift away from the lines it claims to total.

## Permissions

Four modules — `bookings`, `commissions`, `commissionslabs`, `payouts` — created
by the migration and **granted to nobody by default**. Earnings are not
org-visible until an administrator decides they are.

Commissions and payouts scope on `userId`, not the `ownerId` the rest of the CRM
uses: they are somebody's earnings, not somebody's records. Every query that
reads them passes `{ ownerField: 'userId' }`, including the by-id statement
fetch, which re-applies the scope check that the list filter would have applied.

## Checks

`tests/sales/commissions.spec.ts` (30), `tests/sales/payouts.spec.ts` (12) and
`tests/sales/bookings-route.spec.ts` (6). Between them they pin the band boundaries, progressive vs flat totals, gap and
overlap refusal, proration that sums to exactly 100%, the no-signed-slab
refusal, a rate change not restating history, the collected gate, illegal jumps,
clawback arithmetic and its refusal to repeat, both four-eyes controls, tenant
isolation, and the booking transitions — including the guard that refuses to
cancel a sale while commissions are still live against it.

```
npx vitest run tests/sales
```

## Not built

- **Incentives and reward points.** Named in the wider spec but not in M9's
  acceptance criteria, and both need rules finance has not supplied either.
- **A bookings UI.** The API covers the whole lifecycle; commission lines show
  the booking reference as text rather than linking into a page that does not
  exist yet.
- **A payout statement page.** `GET /api/v1/payouts?payoutId=` returns it; there
  is no printable view.
