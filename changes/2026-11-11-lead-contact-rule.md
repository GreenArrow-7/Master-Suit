# A lead somebody types in must be reachable; one that arrives is kept and flagged

## What

The rule the owner decided on 11 November, implemented for **manual creation**:

- full name required, as before;
- **at least one of phone or email**;
- any phone or email supplied must be valid;
- errors land on their own field and keep what was typed;
- company, job title, nationality, tags and sub-source stay optional;
- enforced on the server, which is where anything that posts arrives.

And the other half, which matters as much: an import, a webhook, a form or an
API key keeps the contract it already had. A lead that arrives without a way to
reach anybody is **kept and tagged `needs-contact-details`**, never refused.

## Why

Two sentences in the brief pull against each other — manual creation strict,
incoming enquiries never discarded — and the resolution is the split above. An
enquiry is the asset; refusing one because a field is empty loses it. A worklist
is not a bin.

"Valid" for a phone is `normalizePhone` returning a number, not a stricter rule
invented here. `phoneNormalized` is what the dialler, duplicate matching and
number search all read, so a number that does not normalise is one nobody can
ring — and storing it produces a lead that looks reachable and is not. That was
measured before this change: `'abcdefg'` was accepted, stored, and matched
neither phone-based duplicate rule.

Neither control carries `required`, because the rule is OR and the browser would
block a lead that has the other one. The form says so in a hint; the server
decides.

## Where

- `src/services/leads/createLead.ts` — `assertManualContactRule`, the
  `requireContact` option and `NEEDS_CONTACT_TAG`.
- `src/app/api/v1/leads/route.ts` — `requireContact: !ctx.apiKeyId`, the same
  exemption shape `requireCustom` already used.
- `src/app/(workspace)/[workspaceSlug]/sales/leads/new/LeadForm.tsx` — the hint.
- `tests/sales/lead-contact-rule.spec.ts` — new, 10 cases.

Updates are deliberately untouched, so the leads already in the system without a
contact method stay editable and unrelated edits keep working.

## Behaviour

| Sent by a person                  | Answer                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| name + phone                      | created                                                                                                               |
| name + email                      | created                                                                                                               |
| name only                         | **422**, on both `phone` and `email`: "Give a phone number or an email address, so somebody can follow this lead up." |
| name + `phone: 'abcdefg'`         | **422** on `phone`: "That does not look like a phone number. Include the country code, or leave it blank."            |
| name + email + `phone: 'abcdefg'` | **422** on `phone` — the email satisfies the requirement, the number is still wrong                                   |

| Sent by an import, a webhook or an API key | Answer                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| name only                                  | created, tagged `needs-contact-details`               |
| name + unusable phone                      | created, phone kept **exactly as it arrived**, tagged |
| name + email                               | created, not tagged                                   |
| name only, already tagged `portal`         | created, carrying both tags                           |

The flag rides with the tags the lead already has, so it filters, shows on the
card and comes off by editing — no new column and no second place to look.

## Verified

- `tests/sales/lead-contact-rule.spec.ts` — **10 passed**, covering every row of
  both tables above.
- **Impact measured rather than assumed.** The rule broke 14 existing tests
  across five files — all of them about scope, custom fields, sources or
  scoring, which happened to create a lead with a bare name. Each now supplies a
  distinct number; none of their assertions changed. `tests/permission/lead-record-scope.spec.ts`
  needed a sequence rather than a literal, because its case runs once per role
  and the duplicate check would otherwise fail the second one on a 409 that has
  nothing to do with scope.
- `npx tsc --noEmit` and `npx prettier --check` clean.

## Left open

- **Updates.** A lead edited to remove its last contact method is still allowed,
  on purpose: tightening that would make existing incomplete leads uneditable,
  which the brief ruled out.
- **The tag is a convention, not a schema.** It is visible and filterable, which
  is what "mark for follow-up" needs, but nothing stops somebody deleting it.
- **No stage gate.** The rule applies at creation only. If a lead should not be
  able to reach Qualified without a contact method, that is a separate rule in a
  separate place.
