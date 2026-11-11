# What the phone saw, readable on the phone

## What

A recorder in the workspace shell and a screen at **My Workspace → Diagnostics**
that reads it back. Errors, unhandled rejections and **screens that rendered
nothing** are kept in that browser's own storage, redacted, and shown as plain
text with a Copy button.

Nothing is sent anywhere. The person decides what to share.

## Why

A blank screen was reported on an iPhone after saving a lead. It has not
reproduced on a desk — not in Chromium at phone size, not in WebKit against a
production build over correct HTTPS, in either navigation timing. Six
configurations were eliminated and the fault stayed on the device.

Reading a phone's console needs a Mac and a cable, and most people reporting a
fault have neither. So the evidence has to be collected where the fault happens
and read back there.

**The blank-screen detector is the part that matters.** A soft navigation that
resolves to an empty tree throws nothing: no error handler sees it, which is
exactly why this has been so hard to pin down. Two and a half seconds after a
navigation settles, if the main region has rendered under 40 characters and the
tab is visible, that is recorded as an event in its own right. The delay is
generous on purpose — a page mid-render is legitimately empty, and a false
"blank screen" would send the next person chasing a phantom.

## Privacy — the constraint, not a footnote

This ships to production, so it records what identifies a **defect** and
nothing that identifies a **person**:

- **No record contents.** Never a name, number, address or field value.
- **No identifiers in paths.** `/w/sales/leads/cmwbq1qcz00n07shzjd67tdor`
  becomes `/w/sales/leads/:id` — which screen, never which customer. cuid,
  uuid and numeric segments are all treated as identifiers.
- **No query strings.** They carry filters, search terms and tokens.
- **Identifiers inside messages are redacted too**, because a thrown `TypeError`
  routinely quotes the URL it failed on.
- **Messages truncated at 200 characters.**
- The workspace slug is kept: whoever reads a report already knows the
  workspace, and without it two reports cannot be told apart.

`SELF_SERVICE` gates the screen, which also refuses a **monitoring session**
outright — a read-only observer has no business reading somebody's device log.

## Where

- `apps/web/src/lib/diagnostics/clientLog.ts` — redaction, the bounded buffer
  and the report format. Pure, so it is testable without a browser.
- `apps/web/src/components/diagnostics/ClientDiagnostics.tsx` — the listeners
  and the blank-screen detector.
- `apps/web/src/app/(workspace)/[workspaceSlug]/diagnostics/` — the screen.
- `src/lib/nav/workspaceNav.ts` — under My Workspace, no module required: a
  fault does not wait for the right licence.

## Behaviour

Nothing changes for anyone who hits no errors. The recorder writes only when
something fails, keeps at most 40 events, drops the oldest, and every storage
access is wrapped — a private window, cleared site data or a WebView with
storage disabled all throw, and **a diagnostic that breaks the page it is
diagnosing is worse than no diagnostic**.

## Verified

- `tests/unit/client-diagnostics.spec.ts` — **29 cases**, mostly the privacy
  rules: cuid/uuid/numeric redaction, query strings dropped, identifiers inside
  messages removed, truncation, circular and `undefined` thrown values, the
  bounded buffer, and storage that throws on every call.
- Full unit suite: **1432 passed, 2 skipped, 0 failed** (84 files).
- **In the running application**, signed in at `/manath-homes/diagnostics`: an
  error carrying a real cuid was raised, and what was stored read
  `TypeError: Load failed for /manath-homes/sales/leads/:id` — **the cuid is
  absent from storage**, asserted directly. The screen then rendered the report
  with Copy and Clear.
- `npx tsc --noEmit`, `npx eslint .` and `npm run format:check` clean. ESLint
  was the gate not being run locally, which is how two lint errors reached CI;
  it is now part of the local run.

### The detector, driven against a running application

Not reasoned about — exercised, in a browser, against the dev server on this
branch, with the journey repeated on two separate clean servers:

| Case                                                        | content root | reported |
| ----------------------------------------------------------- | ------------ | -------- |
| **the reported fault** — page region emptied, chrome intact | 0 / 0        | **yes**  |
| a real leads page                                           | 7 / 12       | no       |
| slow load — content arrives at 4.6s, between the two checks | 0 → 7 / 12   | no       |

The fault case stored exactly:

```
2026-11-11T10:50:12Z  blank-screen  /manath-homes/sales/leads
page region rendered nothing 5500ms after arriving, confirmed twice
```

`main` measured **62 characters** in that same moment with the page region
empty, which is the direct measurement that the original `main`-based threshold
could never have fired on this fault.

The report screen was then opened on the same device and photographed: it names
the build (`d3ec1a4c`), the one event and the screen path, with Copy and Clear
enabled. No name, number or field value appears anywhere in the stored entry.

- A navigation completeness guard caught the new screen having no nav entry,
  which is how it got one.

## Three corrections, found by testing the detector against reality

**The first version could never have detected the fault.** It measured `main`
and reported under 40 characters — but `main` also holds the area tabs, whose
labels alone run to 82 characters. A completely blank page would have measured
~82 and never tripped it. It now measures a `[data-content-root]` marker the
layout puts around `{children}` and nothing else, and reports nothing at all if
that marker is missing, because there is then nothing to measure honestly.

**A text threshold alone false-positives.** Measured on a real leads page: the
content root held **7 characters of text and 12 elements**. Any text-only
threshold would have called that a blank screen. The rule is now zero text
**and** zero elements — and the three cases separate properly:

|                        | text / elements | reported |
| ---------------------- | --------------- | -------- |
| sparse real page       | 7 / 12          | no       |
| legitimate empty state | 38 / 3          | no       |
| truly blank            | 0 / 0           | **yes**  |

**Slow loading needed a second look.** One observation cannot tell "not arrived
yet" from "arrived empty", so it waits 4s, checks, waits another 1.5s and checks
again. Only two empty observations are a fault.

## One log per person, and no secrets in it

Redacting record ids out of paths does not make an arbitrary thrown message safe
to copy out. A message is whatever the code interpolated. Removed by shape,
**before** truncation — or the first 200 characters of a token would survive:
bearer and basic credentials, `authorization`/`cookie` headers, anything named
`api_key`/`secret`/`password`/`token`/`session`/`otp`/`pin`, JWTs, email
addresses and phone numbers.

A log with no owner at all is now collected too. `forgetOtherOwners` matched
only `prefix:`, so an unsuffixed value — one was found on the test device,
written by an earlier build of this file — sat there unreadable through the UI
and unreachable by the cleanup. It never shipped, so no real device carries one;
the gap is closed because a log nobody can see is the one thing this must not
leave behind. `tests/unit/client-diagnostics.spec.ts` asserts it, and that
assertion fails on the previous condition.

Storage is keyed per owner — `tenantId:userId`, the same value the offline
outbox already uses, so there is one idea of "whose data is this on this phone"
rather than two. Signing in calls `forgetOtherOwners`, which removes every other
owner's log under the prefix and touches nothing else. A shared branch tablet
does not show the second person the first one's screens.

## Three more shapes, after the owner pushed back

The one-shot check and the "no elements at all" rule left three real screens
unseen. Each is now covered, and each was driven in a browser before being
believed:

| Screen                                                | old rule | now                |
| ----------------------------------------------------- | -------- | ------------------ |
| region holding wrapper elements and no content        | healthy  | **blank-screen**   |
| skeleton that never resolves (text and elements both) | healthy  | **stuck-skeleton** |
| content that disappears after the early checks        | unseen   | **blank-screen**   |
| a page that is merely sparse                          | silent   | silent             |

The region is now sampled every 2s for 30s after arriving instead of looked at
once, so a screen that empties at 16s is reported at 20s. "Empty" no longer
means zero elements — wrappers are not content — but a region holding an image,
chart or canvas is left alone. A skeleton is given 12s before it counts as
stuck, well clear of the 4s empty threshold, so a slow phone is not called a
broken one.

The stuck skeleton was not hypothetical: the local dev server entered exactly
that state — every route parked on `loading.tsx`, all chunks 200, React running,
HMR connected — and the previous rule scored it **7 characters, 12 elements,
healthy**. Whether that shares a cause with the iPhone report is not known and
is not claimed.

`tests/e2e/diagnostics-detector.spec.ts` — **6 cases**, browser evidence, not
device evidence. It creates its own workspace and administrator inside the
product rather than depending on a demo account, so it cannot silently skip.
It holds each broken state in place, because the application re-renders over a
single injected change and a screen that is actually broken stays broken.

## The fixture that broke its own test

The "merely sparse" case went red on CI and green on a desk. What it recorded
was not a detector verdict:

```
error  NotFoundError: Failed to execute 'removeChild' on 'Node':
       The node to be removed is not a child of this node.
```

`holdRegion` keeps a broken state in place by rewriting the page region, and
React is still reconciling that subtree — so React throws, and the error
listener records it. The diagnostic was working. The assertion was wrong: it
demanded an empty log, so the suite could fail for the one reason it must not,
its own fixture, and only where the timing made React lose the race.

The quiet assertions now ask what the _detector_ decided — `blank-screen` and
`stuck-skeleton` — and ignore everything else. The cases that assert a
recording are unchanged and still assert on the full log.

## What the save itself did

A failed request is now recorded: method, redacted path, status. Nothing else —
no request body, no response body, no query string. Asserted on a real 404
carrying a cuid, `?q=John+Smith&token=secret123`, and a name and phone in the
body; what was stored was `POST /api/v1/leads/:id/no-such-route returned 404`
and the spec asserts each of those values is absent.

The instrument re-asserts itself on a timer. Installed once it looked right in a
browser and recorded nothing under the harness, because the framework installs
its own `fetch` wrapper and whichever assigns last wins. Wrapping twice is
harmless: a given fault is recorded once.

## Left open

**This does not fix the blank screen.** It is the instrument for finding it. It
is worth nothing until it is deployed and the fault happens again on the
reporter's phone — at which point My Workspace → Diagnostics should name the
screen, the first error, and whether the main region rendered at all.

It looks **once per navigation**, a few seconds after arriving, so it reports a
screen that arrives blank and not one that is filled and then empties without
navigating. That matches the reported fault; the code carries the note and what
would justify upgrading it to a `MutationObserver`.

The detector reports a symptom, not a cause. If it fires with no error beside
it, that is itself the finding: the tree resolved empty without anything
throwing.
