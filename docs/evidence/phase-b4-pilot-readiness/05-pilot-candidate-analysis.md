# 05 — Pilot candidate analysis

**Phase:** B4.0 · **Date:** 2026-09-08

Five candidates, each grounded in a named file and line. Nothing here is a
demo feature invented to have something to build.

---

## PC-01 — Consolidate the four drifted client-side CSV encoders

**Repository evidence**

| File | Line | Fact |
|---|---|---|
| `src/app/(workspace)/[workspaceSlug]/people/attendance/page.tsx` | 27 | local `csvCell` |
| `src/app/(workspace)/[workspaceSlug]/people/compliance/page.tsx` | 17 | identical local `csvCell` |
| `src/app/(workspace)/[workspaceSlug]/people/face-activity/page.tsx` | 23 | identical local `csvCell` |
| `src/app/(workspace)/[workspaceSlug]/people/work-locations/page.tsx` | 11 | identical local `csvCell` |
| `src/lib/csv.ts` | — | the hardened shared encoder, used by only 2 files |
| `tests/unit/csv.spec.ts` | — | pins every property the local copies lack |

Each local copy quotes and doubles embedded quotes. None has the
formula-injection guard, the UTF-8 BOM, CRLF line endings, or ISO date
handling.

**What that means.** A display name beginning `=`, `+`, `-`, `@` or a tab is
written unguarded. Formula-leading CSV cells **may be interpreted as formulas
by spreadsheet software**; the hardened encoder guards against this class and
these four copies do not.

**Evidence level: `DOCUMENTED`** — the missing guard is `VERIFIED`;
exploitation is not tested here.

**Proposed scope.** Replace the local `csvCell` in **attendance, compliance and
work-locations** with `csvCell`/`csvRow`/`csvHeader` from `@/lib/csv`, and add
unit coverage mirroring `csv.spec.ts`.

**`face-activity` is deliberately excluded** — see the risk note below. It is
proposed as a separate follow-on change at its own risk level, not folded in
to make the pilot look bigger.

**Risk class: R3.** Reasoning in `06`.

---

## PC-02 — `TableSearch` keyboard and screen-reader completeness

**Repository evidence:** `src/components/workspace/TableSearch.tsx`, 6 call
sites. The row count is `aria-live="polite"` (line 73), but the "Nothing on
this page matches" message sits in a plain `<p>` outside any live region, so it
is never announced. There is no Escape-to-clear.

**Proposed scope.** Give the no-match message a live region; clear the input
and restore all rows on Escape.

**Risk class: R2.**

---

## PC-03 — `Pager` link relationships

**Repository evidence:** `src/components/workspace/Pager.tsx`, 4 call sites.
`<nav aria-label="Pagination">` is present and correct; the prev/next anchors
carry no `rel="prev"` / `rel="next"`.

**Proposed scope.** Add the `rel` attributes.

**Risk class: R2**, and honestly closer to R1.

---

## PC-04 — `ExportCsv` blob lifetime

**Repository evidence:** `src/components/workspace/ExportCsv.tsx`.
`URL.revokeObjectURL(url)` runs synchronously on the line after `a.click()`,
and the anchor is never attached to the document.

**What that means.** Revoking a Blob URL in the same tick as the click can
abort the download in some browsers. Chrome generally tolerates it; Firefox
historically does not.

**Honest caveat:** this is a *plausible* defect from a known browser-behaviour
class. **No failing export has been observed or reproduced here**, and B4.0
ran no browser. A pilot would need to reproduce it first, and might find
nothing to fix.

**Proposed scope.** Attach the anchor, click, then revoke on a later tick.

**Risk class: R2.**

---

## PC-05 — Remove the dead `EmptyState` `icon` prop

**Repository evidence:** `src/components/ui/EmptyState.tsx` accepts `icon` and
documents it as rendering nothing. A search of all 43 call sites finds
**zero** passing it.

**Proposed scope.** Delete the prop.

**Risk class: R1.**

---

## Grounding check

Every candidate names a file that exists, a line that says what is claimed, and
a call-site count taken from the repository. `PC-04` is the only one whose
*consequence* is inferred rather than observed, and it says so.
