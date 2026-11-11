# Branches can be created, which makes the BRANCH data scope mean something

## What

`Branch` rows could be created only by the demo seed: no API, no screen. A
workspace the seed had not touched could never fill the "Branch / office" field
on **Add user**, and could never use the **BRANCH** record scope that the role
editor offers beside ORGANIZATION and TEAM.

Branches are now a resource like departments and designations — list, create,
edit, archive — with a screen at **People → Branches**.

## Why

The second half is the part that matters. BRANCH is a visibility scope a role
can be given, and it binds to the set of branches. Granting it in a workspace
with no branches gave that role a scope over nothing, silently: no error, no
warning, just a person who sees fewer records than whoever granted it intended.

The field on Add user was the visible symptom and the smaller problem.

## Where

- `src/services/hr/dispatchContract.ts` — `branches` joins the resource list.
- `src/services/hr/reads.ts` — the list, ordered by name, excluding archived.
- `src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts` — create,
  edit and archive, mirroring `departments`. `isHrAdmin` on each, as the other
  structural resources have.
- `src/app/(workspace)/[workspaceSlug]/people/branches/page.tsx` — new.
- `src/lib/nav/workspaceNav.ts` — the entry, under People.
- `.../people/users/new/NewUserForm.tsx` — the empty state links to the new page
  instead of saying branches are set up by the vendor, which is no longer true.

Name, code, city and country. A branch also carries a timezone and working
hours; those keep their schema defaults until somebody asks for them.

**No migration.** The model, its tenant scope and its indexes already existed —
only the way in was missing. The release stays at 126 migrations.

## Behaviour

- **People → Branches** lists the workspace's offices with the number of people
  posted to each, and adds one from the same form shape the other reference
  pages use. Codes are stored upper-cased.
- Archiving a branch somebody is still posted to is **refused** with 409 — "N
  people are still posted to that branch. Move them first." — the same guard
  departments have, and for the same reason: a user whose branch is archived
  would hold a BRANCH scope over something that is gone.
- **Add user** offers the branches that exist, and when there are none offers a
  link to create one rather than claiming the vendor does it.

## Verified

- `tests/hr/branches.spec.ts` — new, **5 cases, green**: create with the code
  upper-cased, list, edit, the 409 while somebody is posted there, and archive
  leaving the list.
- In the running application at 375x812: the page renders its form and table, a
  branch created through the endpoint appears in **Add user**'s Branch dropdown
  on the next load (`Not set, Al Reem Island, Business Bay, Downtown, Jumeirah
Lakes Towers, QA Marina Office, Sharjah`), and archiving removes it again. The
  QA branch was deleted afterwards.
- The server already accepted and stored `branchId` on account creation
  (`identity/[action]/route.ts`), so no change was needed there — checked rather
  than assumed.
- `npx tsc --noEmit` clean.

## Left open

Region is not exposed. `Branch.regionId` exists and `Region` has the same
problem this change fixes for branches; nothing in the product reads it yet, so
it is not worth a screen until something does.
