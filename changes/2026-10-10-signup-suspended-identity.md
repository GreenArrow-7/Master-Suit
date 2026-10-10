# Signing up could bring back a suspended account

**What.** `createWorkspace` refuses an email whose account is suspended or
deactivated (409: "That email belongs to a suspended or deactivated account…")
instead of setting it active.

**Why.** Found 10 Oct by a check of the Lead Eagle phase notes against the code,
before sign-up was opened. When a workspace is made for an email that already
has an account, `createWorkspace` sets that account `ACTIVE` — right for an
invited account, which has just proved its address, but self-serve sign-up
(phase 6) runs through the same function. So anyone the platform had suspended
or deactivated could sign up a "company" with their own email, click the link,
and be active again with their old password — and back in any workspace whose
membership was still active.

**Where.** `apps/web/src/services/platform/createWorkspace.ts`; a case in
`apps/web/tests/platform/self-serve-signup.spec.ts`.

**Behaviour.** Sign-up and the portal's wizard both refuse such an email; the
platform owner restores the account first (Platform → Users) if it should come
back. An invited or active account is attached as before. A refused sign-up
gives the link back, as any failed one does.

**Verified.** The new case (a suspended and a deactivated account sign up)
fails on the old code — the confirmation answered 200 and the account came back
— and passes on this one; the sign-up spec 7 of 7. Full suite and typecheck:
see the PR.

**Left open.** Nothing for this. The same check found smaller gaps in the phase
notes; they are listed for the owner separately.
