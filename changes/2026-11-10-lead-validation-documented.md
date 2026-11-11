# What a lead must carry, written down, with the one decision isolated

## What

[docs/qa/LEAD-VALIDATION.md](../docs/qa/LEAD-VALIDATION.md): every validation
rule a lead goes through today, each confirmed by calling the running API, and
the single business decision that is actually blocking.

No code changed. No field was made required.

## Why

The field report said every field except Full name is optional. That is true,
and on its own it is not actionable: "add validation" could mean anything from
one field to twenty, and the wrong guess breaks import.

Two things came out of reading it properly.

**The real gap is narrower than "no validation".** A workspace that wants a
phone on every lead cannot express that at all. Custom fields can be marked
required (M18-03); built-in fields cannot. A custom "Phone" field would be a
second field beside the built-in one and invisible to duplicate detection, the
dialler and search, which all read `phone` / `phoneNormalized`.

**There is a measured inconsistency underneath it.** `email` is format-checked
and refused with 422; `phone` is checked for length and nothing else, so
`'abcdefg'` is accepted and stored. `phoneNormalized` is computed from it and
comes out null, so that lead matches neither phone-based duplicate rule, cannot
be dialled and will not be found by a search on the number — while looking
complete on screen.

## Where

- `docs/qa/LEAD-VALIDATION.md` — new.

## Behaviour

Unchanged. Deliberately: making fields mandatory without the rule is the error
the report invites, and adding a phone format check would start refusing numbers
that existing imports contain.

## Verified

Each rule exercised against the running server:

| Sent                             | Answer                                        |
| -------------------------------- | --------------------------------------------- |
| `fullName` only                  | 200                                           |
| `fullName: ''`                   | 422                                           |
| `email: 'not-an-email'`          | 422                                           |
| `phone: 'abcdefg'`               | 200, stored verbatim, `phoneNormalized: null` |
| a second lead with the same name | 200 — a name alone is never a duplicate       |

The default duplicate rules were read from `findDuplicates.ts`: `email`;
`phoneNormalized`; `fullName` with `phoneNormalized`. All five probe leads were
deleted from the local test database afterwards.

## Left open

The decision itself: which built-in fields a lead must carry, whether at
creation or at a stage gate, and whether API keys and intake are exempt as they
are for custom fields. The document states the three parts separately so they
can be answered separately.
