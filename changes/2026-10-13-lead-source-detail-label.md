# A form or landing-page lead names its form again

**What.** The lead page's Source reads the catalogue label and then the form or
landing page the lead came from: `Website · public form · <form key>`,
`Website · landing page · <slug>`. Branch `fix/lead-source-detail-label`.

**Why.** The owner's evidence check (rows M6-06 and M6-09) found these leads
showed only `Website`. #170's entry promises `public form · <form key>`; when
#169's catalogue label was reconciled with #170 in the merge-up, the label won
and the form key or slug (`sourceDetail`) was shown only for a referral.

**Where** (under `apps/web/`)

- `src/services/leads/leadSources.ts`: `leadSourceText` builds the text: the
  label, then the referrer for `REFERRAL`, or the source and the form key or
  slug (`landing:` dropped) for `PUBLIC_FORM` and `LANDING_PAGE`; any other
  source shows the label alone. A lead with no entry reads as before the
  catalogue.
- `sales/leads/[id]/page.tsx` sends that text as `sourceLabel`;
  `LeadDetail.tsx` shows it and no longer receives `source` or `sourceDetail`.

**Behaviour**

- Website-form lead: `Website · public form · website-enquiry`; landing-page
  lead: `Website · landing page · marina-launch`.
- Referral: `Referral · <referrer>`, as before. A portal lead shows its entry
  (`Bayut`) and never its intake key, as before.
- The lead grid and the CSV export have no source column; the allocation
  queue's `public form · <form key>` already matched the entry. Unchanged.

**Verified.** `tests/sales/forms-lead-eagle.spec.ts` (+2): a form lead's and a
landing-page lead's page carry `Website · public form · <key>` and
`Website · landing page · <slug>`; a referral reads `Referral · <name>` and a
portal lead shows `Bayut` without its intake key. On main the first fails:
the page sent `sourceLabel: Website` and the client dropped the form key
(_expected … to contain 'Website · public form · contact-…'_). The second is a
guard on the rules kept; it fails on main only because main built the text in
the client component, which the test does not run. On the branch: the spec
15/15; with `referral-source`, `lead-record-fields`, `lead-eagle-move`,
`field-security` and `lead-record-scope` 6 files, 425/425; `tsc --noEmit`
clean; eslint (no new findings) and prettier clean on the changed files.
