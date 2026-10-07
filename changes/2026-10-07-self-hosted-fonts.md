# The fonts are committed, not fetched from Google

**What.** Inter, Manrope and JetBrains Mono load through `next/font/local` from
files committed in `apps/web/src/app/fonts/`, instead of `next/font/google`.
PR #137.

**Why.** `next/font/google` downloads the fonts from Google on every `next dev`
start and every `next build`: CI's server suite and Build step, and the
production image build. On 6 Oct, CI run 37541802826 (#133) failed in
Integration (server): Turbopack failed on the fonts ("next/font/google queries
have exactly one entry"), the app answered 500 for 180 s and set-up gave up.
Four other runs in the same ten minutes passed. The likely cause is a font URL
from Google with `&` in it, which Turbopack's query parsing splits. The owner
asked for the fonts to be self-hosted.

**Where.**

- `apps/web/src/app/fonts/`: `inter-latin.woff2`, `manrope-latin.woff2` and
  `jetbrains-mono-latin.woff2`, the Latin subset Google serves for the weights
  the layout uses. They are byte-identical to what `next/font/google` served.
  Each is a variable font: one file covers all of a family's weights. Each
  family's `*-OFL.txt` sits beside its font (SIL OFL 1.1, no Reserved Font
  Name).
- `apps/web/src/app/layout.tsx`: `localFont`, with one `src` entry per weight as
  Google's stylesheet declared them. The `--yh-font-*` variables and
  `display: 'swap'` are unchanged.

**Behaviour.**

- Latin text renders exactly as before. The font files, weights and the three
  preloads are the same. Screenshots of the sign-in page and the Leads grid are
  pixel-identical, apart from an animated icon that differs between runs anyway.
- Cyrillic, Greek and most Latin Extended letters (Ł, Ş) now render in the
  Arial fallback, not Inter. `subsets: ['latin']` only chose what was preloaded:
  `next/font/google` also self-hosted Google's other subsets and loaded them
  when such text appeared. Vietnamese is split: the Latin file carries the tone
  marks, but not ă, đ, ơ or ư.
- Next names a local font after its JS variable. So the computed font-family
  reads `inter, "inter Fallback", …` where it read `Inter, "Inter Fallback", …`,
  and likewise `manrope` and `jetbrainsMono`. No code names the families; the
  CSS goes through the `--yh-font-*` variables.
- The Arial fallback face, used until a font loads and for any letter the font
  lacks (Arabic, as before, and now the letters above), is sized from the
  committed file instead of Next's table. size-adjust: Inter 107.12% → 107.89%,
  Manrope 103.19% → 100.14%, JetBrains Mono 134.59% → 131.49%.
- `next dev` and `next build` make no request to Google.

**Verified.**

- In a browser, before and after, on the sign-in page, the Leads grid and
  Check-in: every font-family and weight in use, body text, headings and the
  mono IDs and clock included, is drawn in the same face (Chromium's
  platform-font report), from the same three files (sha256), with three
  preloads.
- `npm run build` passes with every proxy variable pointed at a closed port.
  The old layout, built the same way, fails: "Failed to fetch Inter from Google
  Fonts".
- Typecheck, lint, format check; `npm test`: 3,514 passed, and the 2 skips are
  the POSIX file-mode checks that run on CI's Linux; `npm run test:server`: 6
  passed.

**Left open.** To render names in Cyrillic or Latin Extended in Inter, commit a
wider subset per family as the single file. Every page then loads the larger
file. Not done here: the owner asked for exactly the subsets the layout names.
