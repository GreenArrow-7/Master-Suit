# 08 — Security screening

> **See `13`.** The CSV-injection evidence level is `DOCUMENTED`, not
> demonstrated, and `PC-01`’s class is `UNRESOLVED` under `EVC-016`.

**Phase:** B4.0 · **Date:** 2026-09-08
**Nature:** lightweight screening to detect a candidate that is secretly R4 or
R5. Not a threat model, and not a security review.

## Screening matrix

`—` means the candidate does not touch that surface at all.

| Surface | PC-01 | PC-02 | PC-03 | PC-04 | PC-05 |
|---|---|---|---|---|---|
| Authentication | — | — | — | — | — |
| Authorization | — | — | — | — | — |
| Tenant data boundaries | — | — | — | — | — |
| Sensitive PII | **yes — in the export payload** | — | — | — | — |
| Secrets | — | — | — | — | — |
| File upload | — | — | — | — | — |
| Command execution | — | — | — | — | — |
| SSRF-capable integrations | — | — | — | — | — |
| SQL / data filtering | — | — | — | — | — |
| XSS-sensitive rendering | — | — | — | — | — |
| Redirects | — | — | — | — | — |
| Webhooks | — | — | — | — | — |
| Privileged APIs | — | — | — | — | — |
| Admin functions | — | — | — | — | — |
| Export of sensitive data | **yes — this is the subject** | — | — | **yes — the download mechanism** | — |
| External AI providers | — | — | — | — | — |
| Financial operations | — | — | — | — | — |

## PC-01 — the only candidate with a real security dimension

**It touches export of sensitive data, and that is the point of it.** The
change closes a spreadsheet formula-injection hole in three HR exports that the
server-side export path already defends against.

Direction of travel matters: this **adds** a defence. It removes none, relaxes
none, and changes no access decision. `assertPermission(ctx, resource.module,
'EXPORT')` and the visibility filter are untouched, because those live on the
server route and the four drifted copies are client components.

**Does that make it R4?** Screening says no, on the proposed scope. The change
does not alter which PII is exported, who may export it, how long it is kept,
or where it goes. It alters escaping. The full argument, including the reading
under which it *would* be R4, is in `06`.

**`face-activity` is excluded from scope.** Biometric handling is an
unambiguous R4 trigger, and a page named for facial recognition activity is not
where a first pilot should test the boundary — even though the code comment
there confirms face templates are never exported.

## PC-04 — adjacent, not implicated

It touches the export *mechanism*, not the export *content*. Blob lifetime is a
browser-resource question; nothing about who may download what changes.

## Result

**No candidate is unexpectedly R4 or R5.**

`PC-01` sits nearest the line and is deliberately scoped to stay clear of it,
with the boundary flagged for a Solution Architect rather than settled here.
`PC-02` through `PC-05` do not approach any screened surface.
