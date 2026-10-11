# A Lead-Eagle-only workspace was offered "Send a shortlist", then refused

**What.** The requirement screen shows the shortlist button only where the
workspace owns Sales or Real Estate; a Lead-Eagle-only workspace sees a note
instead. A draft built under `/lead-eagle/` opens where proposals live.

**Why.** The Lead Eagle audit (entry 0): `sales/requirements/[id]/page.tsx`
admits `LEAD_MODULES` and rendered `<SendShortlist>` on the role alone
(`can(ctx, 'requirements', 'CREATE')`), so a Lead-Eagle-only workspace with a
matching listing got the button, filled in the form, clicked Build it and was
told "Real Estate is not enabled for this company." — `/api/v1/proposals` is
`SALES_OR_REALTY`, which is right: proposals are a money/marketing register
(phase 1, owner 5 Oct). And a workspace that owns Sales too, browsing under
`/lead-eagle/`, was sent to `/{slug}/lead-eagle/proposals/{id}`, which does not
exist. Decided from the entitlements (`hasModuleEntitlement`, the lookup the
listing and proposal pages already use for this), not the URL: a path check
would hide the button for a Sales + Lead Eagle workspace that owns proposals.

**Where.**

- `sales/requirements/[id]/page.tsx`: reads the Sales and Real Estate
  entitlements (two Redis-cached lookups, in parallel); renders the button when
  either holds, else a `role="note"` hint (`data-testid="shortlist-unavailable"`).
  `module: LEAD_MODULES` stays — `tests/unit/lead-eagle-routes.spec.ts` pins it.
- `sales/requirements/[id]/SendShortlist.tsx`: new `proposalsModule` prop
  (`'sales' | 'realty'`); a base ending in `/lead-eagle` is rewritten to it
  before the redirect. `/sales/` and `/realty/` callers are unchanged.
- `tests/permission/module-entitlement.spec.ts`: pins the API — the admin
  holds `requirements:CREATE`, Lead Eagle gets 403 on `POST /api/v1/proposals`,
  Real Estate gets past the gate.
- `tests/e2e/lead-eagle-workspace.spec.ts`: a listing and a BUY requirement in
  the Lead-Eagle-only workspace; the match renders, no "Send a shortlist"
  button, the note says "not enabled", and the API still refuses.

**Behaviour.** Lead-Eagle-only: the live matches table as before, with
"Sending a shortlist is part of Sales and Real Estate, which this company has
not enabled." where the button was. Sales or Real Estate: the button as before;
built under `/lead-eagle/`, the draft opens at `/{slug}/sales/proposals/{id}`
(Real Estate's if Sales is not owned). The API refuses exactly as before; the
note only mirrors it. A module switched on in the platform portal clears the
cache, so the button appears at once.

**Verified.** `tests/permission/module-entitlement.spec.ts` (new case, real
database) and `tests/unit/lead-eagle-routes.spec.ts` pass. The E2E step is
written and fails on the old page (the button rendered); it is run by the lead
with the rest of the E2E suite. Prettier and ESLint clean on the four files.

**Left open.** The redirect for a Sales + Lead Eagle workspace browsing
`/lead-eagle/requirements/{id}` has no E2E case: it needs a second wizard
workspace, worth adding when that combination is sold. Noticed in passing:
`/api/v1/owners` is `productModule: 'SALES'` while listings POST requires a
`propertyOwnerId`, so a Lead-Eagle-only or Real-Estate-only workspace cannot
record a property owner, hence a listing, through the app — its own task.
