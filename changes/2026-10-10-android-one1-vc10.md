# Android com.youhan.one1 1.1.0 (10) for closed testing

**What.** `apps/mobile/android/app/build.gradle`: versionCode 9 → 10. Nothing
else in the app changes.

**Why.** The owner's closed-testing release in Play Console for
`com.youhan.one1` (10 Oct) needs a bundle with a fresh versionCode: 9, the
first `com.youhan.one1` bundle (#112, 3 Oct), may already be on Play, and a
code is never reused. The WebView shell is unchanged since 9 (the only change
under `apps/mobile` since then is a removed icon script), so the versionName
stays 1.1.0.

**Where.** That one line; the signed bundle is built locally with the upload
key (it never leaves the machine) and handed to the owner to upload.

**Verified.** See the PR: package `com.youhan.one1`, versionCode 10,
versionName 1.1.0, target SDK 36, not debuggable, backend
`https://one.youhan.in`, signed with the upload key.

**Left open.** The Play Console side (testers, countries, App content
declarations) is the owner's.
