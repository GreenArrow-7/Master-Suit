# The module check in the navigation test waits until the Create menu has opened

**What** — `expectModule` in `apps/web/tests/e2e/entity-navigation.spec.ts` clicks + Create until its menu is open, and never again once it is, then reads the first entry.

**Why** — On 19 Oct, CI on #232 failed "a record opens from the bell, and the shell agrees on the module". The call log showed only "waiting for getByRole('menu')…": the menu never opened. The test clicked + Create straight after `page.goto`, before hydration, and React was not attached yet, so the click did nothing. No change in #232 touched the shell.

**Where**
- `apps/web/tests/e2e/entity-navigation.spec.ts`: `expectModule`.

**Behaviour** — None for users.

**Verified** — CI's full E2E run on this branch. The helper still fails if the menu shows the wrong module, because the first-entry text check is unchanged.

**Left open** — None.
