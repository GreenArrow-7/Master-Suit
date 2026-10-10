# Creating a plan said "The server could not be reached." after creating it

**What.** `apps/web/src/app/(platform)/platform/plans/PlanForm.tsx` holds the
form element before its `await`; a browser test covers the form.

**Why.** The owner created a "Lead Eagle" plan in the platform console on
10 Oct and was told "The server could not be reached." The server had created
it (201): after the response, the form called `event.currentTarget.reset()`,
but React clears `currentTarget` once a handler yields, so that line threw, and
the form's catch-all reports every error as a network failure. The list never
refreshed, so the plan looked missing until a reload — and a second try would
have collided with the code just used. The other forms already hold the element
first (`NewWorkspaceForm`, `WorkspaceRecordForm`, `DocumentUpload`); this was the
only one reading it after an await.

**Where.** That form, and `apps/web/tests/e2e/platform-plan-form.spec.ts`.

**Behaviour.** A plan created from the console appears in the list at once,
with no error, and the form clears.

**Verified.** The new E2E spec (signs in as the platform owner, creates a plan
through the form, expects it in the list and no error) fails on the old form —
the server logged `POST /api/v1/platform/plans 201`, and the list never showed
the plan — and passes on the fix. Typecheck, lint and format clean.

**Left open.** Plans created twice by the old form's message would have failed
on their code; nothing to clean up. Plans cannot be deleted from the console.
