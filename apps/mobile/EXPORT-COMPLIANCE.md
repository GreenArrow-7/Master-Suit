# Export compliance basis — iOS app (`com.youhan.one`)

`ios/App/App/Info.plist` declares `ITSAppUsesNonExemptEncryption = false`. This
file records why, so the declaration is re-checked whenever the inventory changes.

Recorded 2026-09-16 against `dev/mobile-app`, Capacitor 8.5.0. Not legal advice;
the Account Holder confirms the answer when App Store Connect asks.

## Apple's criterion

App Store Connect help, "Overview of export compliance": apps that use only
standard encryption algorithms and crypto functionality within Apple's operating
system (such as HTTPS) do not require export compliance documentation, and can
declare this with `ITSAppUsesNonExemptEncryption`.
(developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)

## Inventory of what ships in the binary

| Component | Encryption-related use | Source of the crypto |
|---|---|---|
| App target: `AppDelegate.swift`, `SceneDelegate.swift` | None (no crypto imports or calls) | — |
| Capacitor 8.5.0 (`capacitor-swift-pm`, frameworks Capacitor and Cordova) | `AppUUID.swift` computes a SHA-256 digest of a UUID (`CC_SHA256`) — hashing, not encryption of data | Apple CommonCrypto (OS) |
| WKWebView loading the HTTPS staging origin | TLS for all traffic | Apple OS networking/WebKit |
| Cordova plugins | None installed (`capacitor-cordova-ios-plugins/sources` is empty) | — |
| Capacitor plugins | None (push removed from this build) | — |
| Third-party SDKs or crypto libraries (OpenSSL, BoringSSL, libsodium, SQLCipher, …) | None | — |

Method: source search of the app target and `node_modules/@capacitor/ios`
(the source of the 8.5.0 frameworks resolved by Swift Package Manager) for
CommonCrypto, CryptoKit, Security/SecKey/SecTrust, keychain classes and OpenSSL
names; review of `Package.swift` dependencies and the Cordova plugin folder.
Assumption: the prebuilt `capacitor-swift-pm` 8.5.0 frameworks match that source.

The web application's own cryptography (password hashing, session tokens, field
encryption) runs on the server, not in the app binary.

## Conclusion

Only OS-provided HTTPS/TLS and an OS-provided hash are used, so the app qualifies
for the exemption and `ITSAppUsesNonExemptEncryption = false` is declared.

## Re-check when

- any Capacitor or Cordova plugin, SDK or native library is added (push, biometrics,
  storage encryption, VoIP, analytics, crash reporting);
- the app stores or transmits data with its own encryption rather than the OS's;
- the app is distributed in France, where Apple notes the French Government controls
  import/export of encryption apps (ANSSI) — confirm before listing there.
