# The image build stopped at /signup

**What.** `apps/web/src/app/(auth)/signup/page.tsx` renders per request
(`export const dynamic = 'force-dynamic'`, the platform pages' idiom).

**Why.** The release images for main `e0c8e06` (#134) failed to build on 8 Oct
(build-images run 37745401425). `/signup` used no request data, so `next build`
prerendered it, and the page asks the database and Redis whether sign-up is
open (`signupOffer`). The image build has neither (the Dockerfile points them at
127.0.0.1 with nothing listening), so the page hung and the build gave up after
three 60-second tries. CI's own build has a database, so it passed there — and
baked the answer of the moment into the page, so opening sign-up in the console
would not have reached `/signup` until the next release.

**Where.** That page only. The sign-in page already rendered per request (it
reads `searchParams`); every other page phases 2–6 added does too.

**Behaviour.** None visible: `/signup` is a 404 while sign-up is closed, and
shows the form once the console opens it — now from the next request, not the
next build.

**Verified.** `npm run build` on the rig with the Dockerfile's build
environment and the database and Redis unreachable (127.0.0.1:1): completes,
and lists `/signup` as dynamic.

**Left open.** The same build failed the worker image on the Google Fonts flake
("next/font/google queries have exactly one entry"); #137 removes that fetch.
