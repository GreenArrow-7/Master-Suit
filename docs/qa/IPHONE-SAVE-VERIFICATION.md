# Checking the save fix on the phone

For whoever holds the affected iPhone. Five minutes. No Mac needed, and nothing
is sent anywhere unless you choose to send it.

## 0. Make sure you are on the new build

Open the app, then **Menu → My Workspace → Diagnostics**.

- If that screen is not there, the new build has not reached the phone. Stop and
  say so — the rest proves nothing.
- If it is there, read the build at the top of the report (`build 9677aa83…` or
  later). That is how we know which code you are testing.

Tap **Clear**, so anything recorded below is from today.

## 1. Editing — the main case

1. Open any lead.
2. **More → Edit details**, change the **Tags** box: add `test1`.
3. Tap **Save**.
4. **Do not touch anything.** Watch the screen.

What should happen: the screen reloads itself and comes back showing the lead,
with `test1` on it.

What we are looking for:

| What you see                                        | What it means                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The lead comes back with `test1`                    | **Working.**                                                                                 |
| A white or blank screen that stays                  | Still broken. Go to section 4.                                                               |
| "Your change is saved. This screen did not reload." | The save worked, the reload did not. **Tap the link in that message**, then go to section 4. |

Repeat this **five times** with `test2`, `test3`, … The fault did not happen
every time before, so one clean run is not proof.

## 2. Editing, then leaving straight away

1. Open a lead, **More → Edit details**, add tag `test6`, tap **Save**.
2. **Immediately** tap **← Leads** at the top — do not wait.

What should happen: you land on the **Leads list**, not back on the lead. Open
the lead again: `test6` is there.

If you end up back on the lead you were leaving, say so — that is the thing this
change was meant to stop.

## 3. Creating a lead

1. **Leads → + Create**, fill in a name and a phone number, tap **Create lead**.
2. Watch the screen.

What should happen: the new lead's own page opens, showing what you typed.

If you see "The lead was created. Its page did not open" — the lead **exists**.
Tap **Open the saved lead**. **Do not tap Create again**, or you will make a
second one.

## 4. If anything above went wrong

1. Wait about **fifteen seconds** without touching the screen.
2. **Menu → My Workspace → Diagnostics**.
3. Tap **Copy report**. If nothing happens, hold your finger on the text,
   **Select All → Copy**.
4. Paste it into a message to us, and say which section number failed and how
   many times out of five.
5. Tap **Clear** before trying again.

The report holds the build, the time, which screen, and what went wrong. Screen
names only — never a customer's name, number or any field value.

## 5. Also worth one minute: Safari

Open **Safari** on the same phone, go to `one.youhan.in`, sign in, and do
section 1 once.

- Blank in Safari **and** in the app → the problem is the web page, and we can
  chase it without touching the app.
- Blank only in the app → it is specific to the app's web view.

Either answer is useful; please say which.

## What counts as fixed

Sections 1, 2 and 3 passing **repeatedly on this phone** — no blank screen, no
duplicate record, no force-closing the app. Until then this is not fixed, no
matter what the tests on our side say.
