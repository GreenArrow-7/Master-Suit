# The phone-shell Columns test read focus a frame early

**What.** `apps/web/tests/e2e/mobile-shell.spec.ts`, "Columns editor is a sheet
inside the screen on Leads and Products", now waits for focus to settle after
Escape instead of reading it once.

**Why.** It failed in CI on #130 and #133 on 7 Oct (focus on `<body>` on
Products) and passed on the same code elsewhere. `ColumnEditor` returns focus
in a `requestAnimationFrame` after the sheet unmounts — on purpose, see its
comment — and the test read `document.activeElement` as soon as the dialog was
gone, so a busy runner could land in that frame.

**Where.** The test's `columnsSheetFits` helper only; no app code changed.

**Behaviour.** None for users: focus still returns to the Columns button, or to
the ••• summary that hid it, one frame after the sheet closes.

**Verified.** The spec's 5 pass on the rig against the demo workspace (2.9
min); CI's E2E on the stack.

**Left open.** Nothing.
