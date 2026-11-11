# Creating a record fetched its own page twice, the second request overlapping the first

## What

Five forms navigated to the record they had just created with
`router.push()` and then immediately called `router.refresh()`. The push
already fetches the destination; the refresh asked for the **same URL a second
time**, and it started before the first request had come back.

Measured in the running application, creating a lead at phone width:

|                                           | start   | duration |
| ----------------------------------------- | ------- | -------- |
| `push()` → RSC fetch of the new lead      | 52919ms | 1848ms   |
| `refresh()` → RSC fetch of the _same_ URL | 54260ms | 535ms    |

The second request began 507ms before the first returned. Afterwards: one
fetch, 360ms, and one `POST /api/v1/leads`.

## Why

`next.config.ts` already says why the refresh is unnecessary, in its own words:
"this codebase navigates after a mutation with `router.push` and relies on the
dynamic staleTime of 0 to re-render the destination." That is exactly what
these five sites do. The refresh was belt and braces, and the braces were
tangled in the belt.

Two overlapping requests for one page are free on localhost and are not free on
a phone, where the first takes seconds rather than milliseconds and the window
in which a second request can abandon it is the whole duration. An aborted RSC
fetch was already observed in this session on an unrelated screen, where it cost
a stale list.

**This is not yet proof that it causes the reported blank screen**, and it is
not written down as such. It is a measured defect on the exact journey that was
reported, fixed because it is wrong on its own terms.

The three auth sites, `OpenWorkspaceButton`, `SupportModeBanner` and
`EntityDelete` keep their refresh: the first five change the session the root
layout is rendered against, and the last pushes back to a list whose contents
the deletion just changed.

## Where

- `AccountForm.tsx`, `ContactForm.tsx`, `LeadForm.tsx`, `MergeForm.tsx`,
  `OpportunityForm.tsx` — the `router.refresh()` after `router.push()`, replaced
  by a comment saying why it is not there, since the next person will otherwise
  add it back.

## Behaviour

Creating a lead, account, contact or opportunity, and merging two leads, still
land on the new record with its data rendered. One request instead of two.

## Verified

In the browser at 375x812 against a seeded database, creating a lead:

- `POST /api/v1/leads` — **exactly one**.
- RSC fetches of the destination — **exactly one** (was two, overlapping).
- The destination rendered, `h1` showing the lead's name, no client errors.
- Back, then into the leads list by a client navigation: **both** newly created
  leads are listed. This was the regression risk of dropping the refresh, and
  the dynamic staleTime of 0 does what `next.config.ts` says it does.

`npx tsc --noEmit` and `npx prettier --check` clean.

## Left open

The blank screen itself. This removes one measured race from the reported
journey; it does not close the defect, which still needs the affected device.
