# Current status — YOUHAN ONE

**As of 30 Oct 2026.** Full detail: `PROJECT_HANDOVER.md`. Architecture: `changes/PROJECT.md`.

---

## Where things stand

| | |
|---|---|
| `main` | `4861a72f` — "the phone app checks in and receives pushes through the mobile API (M20-10) (#237)" |
| Production | `4861a72f`, **126 migrations**, released 19 Oct 2026, re-verified 20 Oct (smoke 18/18) |
| Rollback target | `532f9595` |
| Requirements | **288 of 298 complete (96.6 %)** — 287 live in production |
| Open PRs | **#224 only**, and it is a draft |
| CI on `main` | Green |

**There is no half-finished code and no failing test.** Feature work stopped at a
clean point.

---

## Completed (recent, in release order)

| Released | Commit | What |
|---|---|---|
| 19 Oct | `4861a72f` | Mobile API with device sessions; phone attendance with face on check-in and check-out; native push registration; Play-safe CallWatch (web half); backup evidence in every release; real face engine in CI; fixes for a lost offline change and a call-log deadlock |
| 19 Oct | `532f9595` | Excel export everywhere; SMS from the lead; Outlook calendar sync; Communications grid scoped to the viewer |
| 19 Oct | `65093d65` | Next.js 16.4.2 (fixes a dev-server route-discovery race); E2E deep-route probe |
| 18 Oct | `d237e0c4` | 15-minute reminders; per-workspace data retention; Google Calendar sync; Lead Eagle sign-in branding |

---

## In flight

| Item | State | Waiting on |
|---|---|---|
| **PR #224** — phone app 1.3.0 with push | Draft, merged up with `main`, conflict-free | Firebase file + Apple push profile |
| **iOS 1.2.0** | Submitted 15 Oct, *Waiting for Review* | Apple. The blocking Program License Agreement was accepted 27 Oct |
| **Standalone Lead Eagle Expo app** | Complete on `feat/youhan-one-api` in a **separate local repo with no remote** | An EAS build and store submission |

---

## Pending — all 10 need the owner, none need code

| ID | Needs |
|---|---|
| M17-02, M20-08, PROD-14 | Firebase `google-services.json` + FCM service account; Apple push capability, profile, APNs `.p8`; `FCM_*`/`APNS_*` on production |
| OWN-01, M15-01, M20-01 | Device pass on one Android and one iPhone: sign in, place a call, face check-in and check-out |
| OWN-06, M9-07 | A Twilio account on staging and one real call round trip with a recording |
| PLAN-08b | Platform console → Settings → Self-serve sign-up = 14 days (and restore the setting mis-set on 10 Oct) |
| M20-02 | `eas build` + store submission of the standalone Lead Eagle app |

Step-by-step instructions for each: `C:\ymw\lr\Owner-steps-18-Oct.md`.

---

## Immediate next steps

1. **Owner:** supply the push keys (step 1 above) — it is the single biggest unblock.
2. **Then:** merge PR #224 after CI passes on its exact head commit, build
   Android 1.3.0 (`versionCode` 12) and iOS 1.3.0, submit both.
3. **Then:** mark M17-02, M20-08, PROD-14 complete in the tracker.
4. **Meanwhile, optional tidy-ups:** fix the stale header and four duplicated
   paragraphs in `changes/PROJECT.md`; rewrite the root `README.md`, which still
   describes the old "Master SaaS" layout.

---

## Copy these across with the repository

They are **not** in git:

- `C:\ymw\lr\Lead-Eagle-Tracker.xlsx` — per-requirement status of record
- `C:\ymw\lr\Owner-steps-18-Oct.md` — the 10 open items, step by step
- `C:\Users\admin\Music\Youhan One\Lead Eagle` — the standalone Expo app repo
  (branch `feat/youhan-one-api`, **no remote — back it up**)
- `C:\ymw\chain-release.sh` and `prod-smoke.mjs` — the owner's release chain
