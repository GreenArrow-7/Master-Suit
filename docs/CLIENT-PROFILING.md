# M3 — Client profiling

## What was already here

The spec lists five things. Two of them shipped with earlier modules, because
the demand check needed them:

| M3 asks for | Status |
|---|---|
| Client requirement capture (budget, locations, unit type, timeline) | Already built — `ClientRequirement`, shipped with M5 |
| Requirement-to-inventory matching | Already built — `src/services/inventory/demand.ts` |
| Multi-step client profile | **New** |
| Testimonial request flow | **New** |
| Referral request flow with referral codes | **New** |

So this module is the other three, plus one piece of reuse: the signed public
link was hardcoded to event RSVPs and is now a factory, because testimonials
need the same thing and a second copy of an HMAC scheme is how domain separation
gets forgotten in the third copy.

## The profile

`ClientProfile` follows the person — `leadId` or `contactId`, the same shape
`ClientRequirement` uses, with a check constraint requiring one and a partial
unique index allowing only one live profile each.

**Every field is optional.** A profile is filled in across several
conversations, and a wizard that refuses to save until it knows somebody's
education simply does not get filled in. `upsertProfile` leaves absent keys
alone, so saving one step never blanks another — the difference between "not
answered yet" and "answered as nothing" is what makes a partial save safe.

**Completeness is derived, never stored.** `completeness()` walks a list of
field names per step, so adding a field to a step cannot get out of step with
the function that decides whether the step is done. The column defaults
`UNDECIDED` and `UNDISCLOSED` count as *unanswered* — treating them as answers
made every brand-new profile report itself partly complete and opened the wizard
on a step nobody had touched.

**Income is a Decimal pair, not an enum of bands.** A fixed band ladder is wrong
in the second market you sell in and cannot be changed without a migration;
`annualIncomeMin`/`annualIncomeMax` expresses any band a workspace wants to
offer, with `currency` alongside as the money rule requires. Either edge may
stand alone — "over 500k" is a minimum with no maximum, and that is a real
answer.

**Employer, job title and industry are not repeated here.** They are already on
`Lead`. A profile that disagrees with the lead record is worse than one that
does not answer.

## Testimonials

```
REQUESTED ──▶ SUBMITTED ──▶ APPROVED ──▶ PUBLISHED
     │             │             │            │
     └─────────────┴─────────────┴────────────┴──▶ DECLINED
```

Three people, three authorities:

- **The agent asks.** `POST /api/v1/testimonials` creates the row and returns
  the client's link. Asking again while a request is still open is refused —
  that reads as nagging on their side and as two rows on yours.
- **The client writes it**, unauthenticated, over the signed link. `body`,
  `rating` and `consentToPublish` are set **only** here. There is no staff path
  that writes them, and `decideTestimonial` refuses a transition to `SUBMITTED`
  outright: a testimonial staff can write on a client's behalf is not a
  testimonial.
- **Somebody else decides.** `APPROVED` and `PUBLISHED` need
  `testimonials:APPROVE`, which the migration deliberately does **not** derive
  from `leads` grants — deciding what goes on the website under a client's name
  is not the same authority as working that client.

**Nothing is published without consent.** The client ticks it themselves on the
public form, unticked by default, and the database refuses the row otherwise:

```sql
CHECK ("status" <> 'PUBLISHED' OR "consentToPublish" = true)
```

Declining requires a reason, so nobody asks the same person again next quarter.

## Referrals

**Issuing a code is the referral request.** A code that exists is an ask that
happened, so there is no separate "asked" row to keep in step.

The code is short and typeable — 8 characters from an alphabet with no vowels,
no `0`/`O` and no `1`/`I`/`L` — because it gets read down a phone line and
forwarded on WhatsApp. That also makes it guessable, which is why redeeming one
**attributes** a lead rather than granting any access: the worst a guessed code
achieves is crediting the wrong person for an introduction, which is visible,
reversible and audited. Testimonial links, which do carry authority, use the
signed token instead.

- One live code per client. Two splits their referrals across both and makes
  "how many did they send us" unanswerable.
- **One referral per referred lead**, enforced by a partial unique index. Two
  agents both claiming to have introduced the same buyer is a commission
  dispute, and the database is the only place that can refuse it under
  concurrency.
- The referrer is **copied onto the referral** at redemption. A code can later
  be deactivated or reissued and that must not restate who introduced whom — the
  same reasoning the commission snapshot uses.
- Nobody refers themselves: the lead side is a check constraint, the contact
  side spans tables and is checked in the service.

```
PENDING ──▶ QUALIFIED ──▶ CONVERTED
   └──────────┴──▶ REJECTED (reason required)
```

## The signed link

`src/lib/publicLink.ts` — `{tenantId}.{recordId}.{signature}`, where the
signature covers the ids **and a purpose string**. A link minted for one flow
cannot be replayed against another, which is the property that made it worth
extracting rather than copying.

The tenant is in the token deliberately: without it the public lookup would be
unscoped, which the tenant guard refuses and RLS returns empty for, so the
endpoint would have needed an exception carved into both. Derived rather than
stored, so rotating `WEBHOOK_SIGNING_PEPPER` invalidates every outstanding link
at once. `rsvpToken` is now a thin wrapper and every link minted before the move
still verifies.

## Permissions

Three modules — `clientprofiles`, `testimonials`, `referrals` — backfilled from
`leads` grants at the same scope, because a profile is an attribute of the
person and whoever may work the lead may record who they are.
`testimonials:APPROVE` is the one exception and is granted to nobody.

Note that publishing needs **both** `testimonials:EDIT` (the route gate) and
`testimonials:APPROVE` (the service gate). Approving is an edit plus an
authority.

## Checks

`tests/sales/client-profiling.spec.ts` (30) and `tests/unit/publicLink.spec.ts`
(7): partial saves not clobbering each other, one profile per person, the
soft-delete freeing the person up again, the wizard's resume point, the
backwards income band, the staff-cannot-write rule, cross-tenant and
cross-purpose token rejection, publish-without-consent, the code alphabet, one
live code, double-crediting, self-referral, expiry and use limits, the
scoreboard, and tenant isolation.

```
npx vitest run tests/sales/client-profiling.spec.ts tests/unit/publicLink.spec.ts
```

## A footgun found while testing

`tenantId: { in: [a, b] }` is **not** a literal id, so the tenant guard cannot
pin `app.tenant_id` for it (see the note on `literalTenantId` in
`src/lib/db.ts`). Row-level security then matches nothing and a `deleteMany`
reports success having deleted nothing at all. This is documented, intended
behaviour for the guard, and product code only does it inside
`withPlatformTx` — but M9's test cleanups used that form and were silently
no-ops. They now delete one tenant at a time.

## Not built

- **A profile wizard UI.** The API takes a step at a time and the list page
  shows each profile's completeness and resume point; there is no form yet.
- **Requirement pre-fill from the profile.** Deriving a budget from an income
  band would produce matches nobody can afford, so nothing guesses.
- **Automatic referral rewards.** Reward points were deferred in M9 for the same
  reason: finance has not supplied the rules.
