# Lead Eagle has its own sign-in door

**18 Oct 2026** · feature · PROD-13

## What

`/login?product=lead-eagle` is Lead Eagle's sign-in: Lead Eagle's name beside
the mark, its own line ("Every lead. Followed up.") and the catalogue's
description of it, over the same form, endpoint (`POST /api/v1/auth/login`),
accounts and session as `/login`. PR #219.

## Why

The owner (10 Oct): "Lead Eagle is an application, not a feature." The audit
(row PROD-13) found the meaning unwritten — own sign-in page, branding on
sign-in, store listing or domain. The owner's default for this build: start
with sign-in branding; no new domain, no separate store listing.

## Where

- `src/lib/security/redirect.ts` — `LEAD_EAGLE_LOGIN`; `loginPathFor` sends a
  signed-out visit to `/{slug}/lead-eagle/…` there, `next` included;
  `signOutPath` picks the sign-out door.
- `src/components/auth/AuthShell.tsx`, `BrandHero.tsx` — `product="lead-eagle"`:
  the lockup, line and description; no ecosystem graphic (it draws the whole
  platform). `src/styles/auth.css` centres the message in its place.
- `src/app/(auth)/login/page.tsx`, `LoginForm.tsx` — read `?product=lead-eagle`;
  "Sign in to Lead Eagle with your YOUHAN ONE account."; "Start your Lead Eagle
  trial" while sign-up is open, never inside the iOS app.
- `src/components/nav/TopBar.tsx` — signing out of a Lead-Eagle-only workspace
  goes to the Lead Eagle door, with that workspace's board as `next`.
- `src/app/(auth)/signup/**` — self-serve sign-up (it only ever makes a Lead
  Eagle workspace) wears the Lead Eagle frame, and its Sign in links go to the
  Lead Eagle door; the one after confirming carries the new workspace's board
  as `next`.

## Behaviour

- `/login` with no `product`, or any other value, is unchanged.
- A Lead-Eagle-only workspace still lands on `/{slug}/lead-eagle/dashboard`
  (`workspaceLanding`, built before this change) from either door.
- A person in two workspaces is landed by the server on the oldest one. So the
  Sign in button after a Lead Eagle sign-up, and the door a Lead-Eagle-only
  workspace signs out to, carry that workspace's board as `next`: alice, in
  Sales `acme` since before, lands on `/eagle/lead-eagle/dashboard`, not
  `/acme/dashboard`. `signInLanding` drops the `next` when whoever signs in
  next does not belong to that workspace.
- The sidebar already names the section "Lead Eagle" (owner, 5 Oct); unchanged.

## Verified

- `tests/unit/lead-eagle-sign-in.spec.ts` (7): the branded page renders the
  Lead Eagle name and line and the plain page's `LoginForm` (the same endpoint);
  the trial link hides inside the iOS app and while sign-up is closed; `/login`
  and `?product=sales` are as before; a signed-out Lead Eagle screen goes to the
  Lead Eagle door, every other screen to `/login`. 4 of the 7 fail on the old code.
- Review fixes, same spec (now 10): the confirm page's Sign in and the
  Lead-Eagle-only sign-out carry the workspace's board, and an account in an
  older workspace lands back in Lead Eagle; 3 fail on the code before the fix.
  With the touched areas' specs: 7 files, 62 tests pass; `tsc` clean.
- First build, with the touched areas' specs: 11 files, 467 tests pass; `tsc` clean.
- No browser check on the rig: it has no local `next` to run a dev server.

## Decisions taken

- The URL is `/login?product=lead-eagle`, not `/lead-eagle/login`: a top-level
  `lead-eagle` folder would shadow a workspace slugged `lead-eagle` (the slug is
  not reserved) and need a second page; the query keeps one page and one route.
- No Lead Eagle mark exists in the repository, so the lockup is the YH mark with
  the Lead Eagle name; nothing taken from any other product's name, logo, colours
  or layout. Colours stay the platform's.
- The form says "with your YOUHAN ONE account", so nobody thinks Lead Eagle is a
  second account.
- The platform-wide counts (hours saved, actions automated) stay on the Lead
  Eagle door; they are measured, not claimed.
- Sign-out returns to the Lead Eagle door only for a workspace whose one product
  is Lead Eagle (the same rule as `workspaceLanding`).
- Forgot-password, MFA enrolment and invitations keep the plain frame.

## Left open

- A Lead Eagle mark of its own (design team), a domain, or a store listing:
  each a further owner choice.
