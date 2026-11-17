# The white screen after saving: a confirmed save no longer uses the client router

## What

A successful lead save now navigates with one validated same-origin full-page
GET instead of `router.refresh()` / `router.push()`. Branch
`fix/post-save-navigation`, cut from `diagnostics/on-lead-release`.

## Why — the mechanism, read out of the installed framework

The owner reported, from the affected iPhone: the database is updated, the app
shows a white screen immediately after saving, closing and reopening shows the
saved data, and it happens **after every change**, not only when navigating
quickly.

A save hands the next screen to the App Router's client RSC transition. When
that transition cannot produce a payload, Next does not raise an error — it
converts the failure into an MPA fallback. In
`node_modules/next/dist/client/components/app-router.js` (16.4.2), inside the
block guarded by `pushRef.mpaNavigation`:

```js
// This is a side effect in render. Don't try this at home, kids.
if (globalMutable.pendingMpaPath !== canonicalUrl) {
  location.assign(canonicalUrl); // or .replace
  globalMutable.pendingMpaPath = canonicalUrl;
}
// TODO-APP: Should we listen to navigateerror here to catch failed navigations
throw _unresolvedthenable.unresolvedThenable;
```

`location.assign` is called **inside a React render pass**, then the subtree is
suspended with `unresolvedThenable`, which has no resolution path. Suspending is
not an error, so no error boundary renders. `pendingMpaPath` then blocks any
retry to the same URL. The page's content is gone before the GET is even in
flight, so a GET that does not commit leaves a blank document at the right URL,
with no error page and no way out but a new document. That is exactly "closing
and reopening the app shows the updated data".

**Quoted from the installed source and verified byte-for-byte**, not inferred.

The repository had already recorded the other half in WebKit
(`docs/qa/BLANK-SCREEN-WEBKIT.md:119-131`): the post-save RSC request is
cancelled, `Failed to fetch RSC payload … Falling back to browser navigation`,
and then the fallback document request is itself cancelled.

## What is NOT established

**Why the transition fails in a Capacitor WKWebView and not on a desk.** That is
unidentified. This change removes the post-save path's dependence on the client
transition; it does not explain the trigger, and it is **not a verified
workaround** — nobody here has touched the device and no device test is claimed.

One branch remains honestly unfixable from the page: if a top-level GET of the
record URL cannot commit in that WebView at all, no change to a save handler can
help, because every route to that page is such a GET.

## Where

- `apps/web/src/lib/navigation/afterSave.ts` — new. `sameOriginPath` refuses an
  off-origin destination, `recordPath` validates an id before it becomes a URL,
  `afterSave` issues one `location.assign` from an event handler on a document
  that is still painted, and arms a 3.5s check that records — and surfaces — a
  navigation that never commits.
- `LeadDetail.tsx` — `patchLead` replaces `router.refresh()`. All five editing
  flows go through it (Edit-details Save, assign, secondary owner, stage move,
  notes), which is what "after each change" means. A confirmed save whose reload
  does not arrive shows a fixed notice above the tab bar with one `<a href>` —
  never a repeat of the write, because a stage move carries side effects.
- `LeadForm.tsx` — creation navigates to the id the save returned. `useRouter` is
  deleted (it would fail `no-unused-vars`). `busy` is left set across the
  navigation so a second tap cannot POST a second lead; the no-usable-id path
  releases it and offers the list.
- `clientLog.ts` / `ClientDiagnostics.tsx` — `setLogKey` + `noteDiagnostic`, so a
  non-component can write to the owner-scoped log the Diagnostics screen already
  reads. Named `setLogKey`, not `useLogKey`: a `use` prefix makes the lint rules
  treat a plain setter as a hook.

## The person's own navigation wins

Found by running the existing journey spec against the first version of this
change: with an unconditional `location.assign`, a save followed immediately by a
tap on **← Leads** landed back on the **record**. The fix had reintroduced the
reported complaint from the other side — the tap was swallowed.

`afterSave` now takes the timestamp the save began and yields if the person
tapped a link after it. Their navigation wins, ours is skipped, and the fact is
recorded. That is the difference between the two specs below: one navigates
away, one does not.

## Verified

- `tests/e2e/post-save-full-navigation.spec.ts` — new. The discriminator is
  **zero `?_rsc=` requests after the save**, which is engine-independent:
  `router.refresh()`/`push()` always issue one, before any fallback can occur.
  Counting documents does **not** work — under this diagnosis the unfixed code's
  MPA fallback also produces a document, so that would pass pre-fix.
  **Red before, green after:** with the handlers reverted the spec fails; with
  them it passes.
- A flaw in the first version of that spec, found and fixed: `waitForURL` on an
  unchanged URL and `readyState === 'complete'` on the _old_ document both pass
  instantly, so the whole test ran before the PATCH was sent and the key
  assertion passed vacuously. It now stamps a marker on the document and waits
  for it to be gone, which is the only engine-independent proof that a new
  document committed.
- `tests/e2e/lead-save-navigate.spec.ts` — the journey, unchanged in intent: 3
  rounds, `1 PATCH request(s), 1 distinct key(s), 0 replayed, statuses 200`,
  destination renders, tags correct. Its DOM probe now tolerates the document
  swap.
- 9 e2e cases green together; 181 files / 2680 tests across unit and sales;
  eslint 0 errors, tsc and prettier clean.
- **No device test. No Mac. Nothing observed on the affected iPhone.**

## Left open

The other `router.refresh()` sites are untouched: 146 across the app, including
six more in `LeadDetail.tsx`. They are not changed because no flow other than
the lead save has a demonstrated defect, and the owner asked for the shared
correction to be applied only where the defect is shown.
