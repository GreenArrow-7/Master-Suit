# The blank screen, on the phone

For whoever holds the affected iPhone. Ten minutes, no Mac, no cable.

Nothing here is sent anywhere by itself. The report stays on the device until
somebody copies it out and chooses where to send it.

## Before you start

**Check you are on the build that records.** Open the app, then:

> **Menu → My Workspace → Diagnostics**

If that screen is not there, the build on this phone cannot record anything and
there is no point doing the rest — the corrected build has not reached the
device yet. Say so and stop.

If it is there, note the build shown at the top of the report (something like
`build 37067327`). That answers the first question anybody will ask.

Tap **Clear** so that anything below is from this round and not an older one.

## The journey, exactly

Do this **five times**. The fault does not happen every time, which is the
whole difficulty — four clean runs prove nothing on their own.

1. **Leads → +Create**, or open a lead you already have.
2. Change something you will recognise afterwards. A tag is easiest:
   **More → Edit details → Tags**, type `vip, test1` (then `test2`, `test3`,
   … on later rounds, so each round is distinguishable).
3. Tap **Save**.
4. **Immediately** tap **← Leads** at the top of the record — do not wait for
   the spinner, do not wait for the screen to settle. The speed is the point:
   the fault only appears when the move happens while the save is still going.
5. Look at what you get:
   - the Leads list, normally → **good**, carry on
   - a **blank** or white area where the list should be, with the app's own
     bars still showing → **this is the fault**
   - a spinner or grey placeholder that never becomes a list → **also the
     fault**, and a different shape of it
6. Open the lead again and check the tag you typed is there.

Between rounds, **do not force-close the app**. Closing it is the workaround,
and the recording survives a restart anyway — but if you restart you lose the
chance to see whether it recovers on its own.

## If a screen goes blank

Write down which round it was and what you saw. Then:

1. Wait about **fifteen seconds** without touching anything. The recorder looks
   at the screen for half a minute after you arrive, and it needs two looks to
   be sure. Leaving too quickly loses the evidence.
2. Then go to **Menu → My Workspace → Diagnostics**.
3. Tap **Copy report**.
   - If nothing appears to happen, the clipboard was refused. The text is on
     the screen and can be selected by holding your finger on it, then
     **Select All → Copy**.
4. Paste it into whatever you use to reach us — a message or an email is fine.
5. Tap **Clear** before the next round, so the next report is only about the
   next fault.

## What the report contains, and what it does not

It holds the build, the time to the second, which **screen** you were on, and
what went wrong. Screen paths only: `/sales/leads/:id`, never the customer's
name, number or any field value. Error text has bearer tokens, passwords, API
keys, email addresses and phone numbers removed before it is stored.

It is kept on this phone, under this account. Another person signing in on the
same device sees their own and never yours.

## If nothing is ever recorded

That is a result too, and worth reporting. It means either the journey did not
fail in those five rounds, or it failed in a way the recorder cannot see. Say
how many rounds you did and that the report was empty.

## What counts as fixed

Not "the diagnostics work", not "the tests pass". The journey above, repeated
on this phone, on the corrected build, **without** a blank screen, without the
save landing twice, and without force-closing the app.
