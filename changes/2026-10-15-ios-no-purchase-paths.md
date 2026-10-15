# Nothing in the iOS app sells, prices or points at buying the service

**15 Oct 2026** · fix · App Store review

Apple rejected iOS 1.1.0 (11) under guideline 3.1.1 (paid service without In-App Purchase). YOUHAN ONE is sold to companies for their staff (3.1.3(c), Enterprise Services), so the fix is to show no purchase path inside the iOS app.

- `lib/mobile/iosApp.ts`: a request is from the iOS app when its user agent carries `YouhanOneApp/` and not `Android` (an iPad's WebView reports a Mac).
- Inside the iOS app only: no "Start a free trial" link on sign-in; `/signup` and `/signup/confirm` answer 404; Admin → Subscription answers 404 and leaves the menu; the dashboard's Subscription card and the top bar's plan badge are hidden.
- Browsers and the Android app are unchanged.
- Test: `tests/unit/ios-app-user-agent.spec.ts`.
