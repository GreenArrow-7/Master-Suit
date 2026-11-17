# What a lead must carry today, and the one decision nobody has made

Written 10 November 2026 in answer to the field report that "every field except
Full name is optional". That is true, and it is not the whole picture. Every
rule below was read from the code and then **confirmed against the running
application** by calling `POST /api/v1/leads`; the status codes are measured,
not inferred.

## The rules that exist

### Required

**`fullName` only.** 1–160 characters.

| Sent                     | Answer                                      |
| ------------------------ | ------------------------------------------- |
| `{ fullName: 'A Name' }` | **200** — a lead with nothing else is valid |
| `{ fullName: '' }`       | **422** "1 field failed validation"         |

The form marks exactly that one field, so the form and the server agree. There
is no disagreement between them to fix.

### Validated when present

| Field                                          | Rule                                                | Measured                               |
| ---------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| `email`                                        | a well-formed address, ≤254                         | `'not-an-email'` → **422**             |
| `phone`                                        | **≤32 characters, and nothing else**                | `'abcdefg'` → **200**, stored verbatim |
| `fullName`                                     | ≤160                                                |                                        |
| `firstName`, `lastName`                        | ≤80                                                 |                                        |
| `company`                                      | ≤160                                                | `jobTitle` ≤120                        |
| `country`, `city`                              | ≤80                                                 | `nationality` ≤80                      |
| `sourceDetail`                                 | ≤160                                                | `campaignName` ≤120                    |
| `tags`                                         | ≤20 tags, each ≤40                                  |                                        |
| `priority`                                     | one of LOW / MEDIUM / HIGH / URGENT, default MEDIUM |                                        |
| `sourceId`, `campaignId`, `stageId`, `ownerId` | a cuid when sent                                    |                                        |

### Beyond field shape

- **Duplicates.** Checked on create and on edit, default `BLOCK` → **409**
  naming what matched. Until an administrator configures rules in
  **Administration → Duplicates**, three defaults apply, in order: `email`
  alone; `phoneNormalized` alone; `fullName` **and** `phoneNormalized` together.
  A name on its own never matches — two leads called "QA Rules Probe A" were
  both accepted, measured.
- **Custom fields can be made required**, per workspace (M18-03). This is the
  only required-field setting the product has. It is enforced for a person and
  deliberately skipped for an API key and for intake, so an integration still
  lands a lead that leaves one out.
- **Field permissions** strip anything the actor may not write before validation
  runs, so a crafted payload cannot set a field its role is denied.

## The inconsistency the report probably meant

**`email` is format-checked and `phone` is not.** `'abcdefg'` is accepted as a
phone number and stored as typed.

That is not only untidy. `phoneNormalized` — the field the product actually uses
— is computed from `phone`, and junk normalises to `null`. So a lead with an
unusable number:

- cannot be matched by **either** phone-based duplicate rule, so it is invisible
  to duplicate detection while _looking_ like it has a phone;
- cannot be dialled, and will not be found by a search on the number.

The lead looks complete on screen and is not reachable. It is worth deciding
separately from the question below, because it is about a value being usable
rather than about a value being present.

## The decision nobody has made

**Which built-in fields must a lead carry, and when?**

It needs an answer because of a specific gap, not as a matter of taste: a
workspace that wants a phone number on every lead **cannot express that today**.
Only custom fields can be marked required, and a custom "Phone" field would be a
second field beside the built-in one — invisible to duplicate detection, to the
dialler and to search, all of which read `phone` / `phoneNormalized`.

Three parts, and they are separable:

1. **Which fields.** A phone or an email — or either one of the two, which is
   the rule most brokerages actually work to. Requiring both would be wrong:
   imported lists and cold-call sheets routinely have one and not the other, and
   a rule that rejects them breaks import rather than improving data.
2. **At which point.** Creation is the strictest and the most likely to be
   resented by somebody taking a call. The alternative is a **stage gate** — a
   lead may be created bare but cannot be moved past, say, Qualified without a
   way to contact it. The pipeline already has stages, so this costs no new
   concept.
3. **Who is exempt.** Custom fields already exempt API keys and intake. The same
   question applies here, and the same answer is probably right: a webhook that
   drops a lead on the floor because a field is missing loses the lead.

Until (1) and (2) are answered, nothing should change. Making every field
mandatory would break import; guessing at a subset would be the same mistake
with fewer fields.

## What was deliberately not changed

- No field was made required.
- `phone` was left unvalidated. Adding a format check is a one-line change and
  a real decision: it would start refusing numbers that existing imports
  contain, and whether that is a fix or an outage depends on data nobody here
  can see.
