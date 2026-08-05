# Real-device UAT checklist

**Status: NOT STARTED. Zero devices tested.**

Nothing in this document has been executed. The responsive layout has been
verified only by reading CSS and component source, which is not device
validation and must not be recorded as such. A layout that inspects correctly
still fails on a real handset for reasons source cannot show: the iOS Safari
viewport changing height as the toolbar hides, `100vh` overflowing, tap targets
that are large enough in CSS pixels and too small under a real thumb, camera
permission prompts that behave differently per OS version.

## Rules for the tester

1. **Record the real device and the real browser version.** "Android Chrome" is
   not a result; "Pixel 7a, Android 14, Chrome 126.0.6478.71" is.
2. **Evidence for every row.** A screenshot, a screen recording, or a written
   observation with the timestamp. A tick on its own is not evidence.
3. **A row you did not run is BLOCKED or NOT RUN, never PASS.**
4. **Camera rows need HTTPS or localhost.** Browsers refuse `getUserMedia` on a
   plain `http://192.168.x.x` address no matter how the server is configured, so
   testing over a LAN IP will fail for reasons unrelated to the app. Use the
   cloudflared tunnel or a TLS terminator.

## Device matrix

| # | Device class | Minimum target | Tester | Device + OS | Browser version | Date |
|---|---|---|---|---|---|---|
| D1 | Android phone | Chrome, Android 12+ | | | | |
| D2 | iPhone | Safari, iOS 16+ | | | | |
| D3 | Tablet | iPad Safari or Android Chrome | | | | |
| D4 | Small screen | ≤360 px wide (e.g. Galaxy A-series) | | | | |

## Scenarios

Run every scenario on every device in the matrix.

| ID | Scenario | What counts as a pass | D1 | D2 | D3 | D4 | Evidence |
|---|---|---|---|---|---|---|---|
| S1 | Sign in | Keyboard does not obscure the submit button; no horizontal scroll | | | | | |
| S2 | Sidebar navigation | Hamburger opens, closes on selection, does not trap focus | | | | | |
| S3 | People overview | Metric cards reflow; nothing clipped | | | | | |
| S4 | Leave queue (`/people/leave`) | Table stacks into labelled rows below 760 px; approve/reject reachable one-handed | | | | | |
| S5 | Lifecycle checklist | Long task titles wrap rather than overflow | | | | | |
| S6 | HR policy (`/people/settings`) | Number inputs usable; help text legible without zoom | | | | | |
| S7 | Documents | Upload opens the OS file picker; camera-capture option appears on mobile | | | | | |
| S8 | Check-in camera permission | Prompt appears; denial shows the app's message, not a blank frame | | | | | |
| S9 | Check-in capture | Live preview is not mirrored-confusing; challenge instruction readable in sunlight | | | | | |
| S10 | Check-in in portrait and landscape | Both orientations usable; no layout break on rotation | | | | | |
| S11 | Audit log | Domain filter chips wrap; long metadata truncates rather than overflowing | | | | | |
| S12 | Roles matrix | Scope dropdowns operable; disabled options visibly disabled | | | | | |
| S13 | Session expiry | With the tab left open past the idle timeout, the next action refreshes silently or returns to sign-in — never a silent no-op | | | | | |
| S14 | Reduced motion | With OS "reduce motion" on, the sidebar does not animate | | | | | |
| S15 | Screen reader pass | VoiceOver/TalkBack can reach navigation, form labels and error alerts | | | | | |

## Known risks to look for specifically

- **iOS Safari and `getUserMedia`**: requires a user gesture and a secure
  context. S8 is the row most likely to fail first on iPhone.
- **HEIC uploads from iPhone**: the document upload accepts HEIC, but iOS may
  convert to JPEG on selection. Record which format actually arrived.
- **`100vh` on iOS**: the shell uses flexible layout, but any full-height
  container can overflow when the toolbar retracts.
- **Small-screen tables**: the stacked layout is new and has never rendered on a
  real device.

## Sign-off

Device UAT is complete only when every cell above is filled with a result and
evidence, on at least the four device classes. Partial completion is partial —
record it as such.

| Role | Name | Date | Signature |
|---|---|---|---|
| Tester | | | |
| Reviewer | | | |
