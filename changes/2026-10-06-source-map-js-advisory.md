# source-map-js 1.2.2 for a new advisory

**What.** `source-map-js` 1.2.1 → 1.2.2 in `apps/web/package-lock.json`, in #128.

**Why.** GHSA-68fv-2mgg-jv7q (high: event-loop denial of service through indexed
source-map section offsets), published 5–6 Oct. postcss brings `source-map-js`
into the production tree, so CI's last gate, `npm audit --omit=dev
--audit-level=high`, failed #128 — and would have failed every PR and `main`.

**Verified.** Lockfile only, one package; `npm audit --omit=dev --audit-level=high`
reports 0. CI's build and browser tests run on it.
