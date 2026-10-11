# Reading a client profile by lead or contact reached any buyer in the workspace

**What.** `GET /api/v1/client-profiles?leadId=` and `?contactId=` apply the
list's rule now (#143, after #140): `profileFor` reads with
`visibilityWhere(ctx, 'clientprofiles', 'VIEW')`, as the list beside it does.

**Why.** The by-subject read checked `clientprofiles:VIEW` at any scope and the
tenant, nothing else. An agent at OWN scope could quote any lead or contact id
in the workspace and read that buyer's profile: profession, income band,
investment capacity, nationality, residency, mortgage status, notes. The writes
were already scoped. #140 left this open; the owner asked for the fix on 8 Oct.

**Where.**

- `services/clients/profile.ts`: `profileFor` merges the list's scope into its
  subject filter, so every caller gets it.
- `tests/permission/client-profile-scope.spec.ts`: the spec.

**Behaviour.** A profile the caller's list would not show reads exactly like no
profile: `{ profile: null, completeness }`, with the wizard on its first step.
The answer cannot say a profile exists. Team scope reads the team's profiles;
organisation scope sees no change. The lead is not checked: the answer carries
nothing of the lead, the list shows a profile whatever became of its lead, and
a lead check would turn the null answer for an unknown lead into a 404. No
screen changes: nothing in the app calls this read (there is no wizard UI yet,
`docs/CLIENT-PROFILING.md`), the Clients page already uses the list's rule,
and `e2e/modules.spec` only saves a profile.

**Verified.** `tests/permission/client-profile-scope.spec.ts`, 6 tests on the
hierarchy fixture, by lead and by contact:

- An OWN rep gets the same answer for a teammate's profile as for an id with none.
- The rep reads their own profile.
- A team manager reads the team's profile, not another team's.

On the old service 4 of the 6 fail (the refusals: "expected … to deeply equal",
"expected … to be null"). Also green, on a scratch database at main's 98
migrations: `client-profiling.spec` (30), `lead-attach-scope.spec` (29),
`visibility-where-merge`, `scope` and `nav-permissions` (91 tests in all);
`tsc`, eslint and prettier.

**Left open.**

- A profile stays with whoever started it. Once its lead is reassigned, the new
  owner at OWN scope reads null here, and saving answers 403, which says a
  profile exists. Whether a profile follows its lead is the owner's decision.
- Still open from #140: `leads/assign`, event invitees, `tasks/{id}` and
  `follow-ups/{id}`, and the `contactId`, `callId`, `requirementId` and
  `accountId` references.
