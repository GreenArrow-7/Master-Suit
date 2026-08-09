# CSV export

§4 asks every list to be server-paginated, filterable, sortable and
CSV-exportable. This is the export half.

| What | Where |
|---|---|
| Leads | `GET /api/v1/leads/export` (pre-existing; honours saved grid columns and field masking) |
| Listings, projects, contacts, accounts, opportunities, commissions | `GET /api/v1/exports/{resource}` |
| The ten reports | `GET /api/v1/reports?report=…&format=csv` |
| HR reports | `GET /api/v1/workspaces/{slug}/hr/reports/{key}/export` |

## One encoder, because the second copy was already wrong

The lead export got several things right that a naive `rows.join(',')` does not.
The report export, written later, got some of them wrong — it quoted only cells
that looked like they needed it and had **no formula-injection defence at all**.
Both now share `src/lib/csv.ts`.

**Formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed by Excel
and Sheets when the file is opened. A lead named `=HYPERLINK("http://…","Click")`
becomes a phishing link that arrives inside your own export. Those cells get an
apostrophe prefix, which both programs strip on display.

**Except plain numbers.** `-82500` is a clawback, not an attack, and prefixing it
makes Excel treat the cell as text — so a money column full of negatives silently
stops summing. A value matching `^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$` cannot be a
formula, so it is left alone. `-2+3+cmd` still is not a number, and still gets
the prefix.

**A byte-order mark**, or Excel reads UTF-8 as the local codepage and every
non-ASCII name arrives mangled.

**Everything quoted**, rather than only what looks like it needs it — cheaper to
reason about and impossible to get subtly wrong. CRLF line endings, as RFC 4180
asks.

## Streaming, not gathering

`csvStream` fetches a keyset page, writes it and drops it, so memory is bounded
by the page size rather than by the size of the result. There is no row limit: an
export with one is a report somebody silently gets half of.

Keyset rather than offset for the reason every list here uses it — an `OFFSET`
deep into a large table re-scans everything before it, and rows inserted
mid-export shift the window so a row is skipped or repeated.

## What an export may not do

- **Bypass scope.** The `where` comes from `visibilityWhere` on the same module
  and action the list route uses. An export is a list; it sees what the list sees.
- **Bypass permission.** The gate is `EXPORT` on the module, not `VIEW`. Reading
  a list on screen and taking the whole thing out of the building are different
  authorities, and every resource here already defined the second.
- **Go unrecorded.** Each finishes with an `EXPORT_REQUESTED` audit entry
  carrying the row count, written **on completion** so it reflects what actually
  left rather than what was asked for.

`/api/v1/exports/{resource}` is not routed through the API kernel, for the same
reason the lead export is not: that helper always answers JSON and an export has
to stream a file. It runs the same gates in the same order and translates errors
the way the kernel would — without that, an unauthorised export answers 500 and
reads as a fault rather than a refusal.

## Checks

`tests/unit/csv.spec.ts` (14) and the CSV block of `tests/sales/reports.spec.ts`:
quoting, embedded quotes and commas and newlines, the BOM, ISO dates, the
formula guard and its numeric exemption, keyset paging across a short final page,
an empty export still being recorded, and the download headers.

```
npx vitest run tests/unit/csv.spec.ts
```

## Not covered

- **Field masking** outside leads. The lead export runs `applyFieldSecurity`, so
  an export cannot be a way around field-level security. The shared route does
  not — none of its six resources currently declares sensitive fields, but the
  moment one does, this needs the same treatment.
- **Filters.** The shared route exports the caller's whole visible list; it does
  not accept the list route's query filters. The lead export does accept its own.
- **Modules with no `EXPORT` action** — bookings, payouts, visits, requirements,
  client profiles, referrals, testimonials, posts, contests, allocation. Adding
  one is a migration, and nothing has asked for it yet.
