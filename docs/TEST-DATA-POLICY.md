# Test-data policy

## The rule

**Never commit an identifiable person's data to this repository.** Specifically
prohibited as test fixtures, sample data, evidence or screenshots:

- photographs of identifiable faces, including celebrities and stock imagery
- passports, Emirates ID cards, visas, labour cards, driving licences
- real employee documents of any kind, redacted or otherwise
- real names paired with real salary, medical, disciplinary or biometric data
- exported face embeddings or attendance capture frames
- production database dumps

## Why the bar is this high

Git does not forget. A file deleted in one commit stays in history, in every
clone anyone has ever taken, and in every fork and backup. Removing it later
requires rewriting history and coordinating every clone — and cannot recall the
copies already distributed. **The only reliable control is not committing it.**

For biometric data specifically, a face photograph is personal data under the UAE
PDPL, and a face template derived from one is *sensitive* personal data. Neither
belongs in a source repository, whose access-control model is "everyone with a
clone, forever".

## What happened here

`apps/hrms/tests/faces/lena.jpg` and `messi.jpg` were photographs of real,
identifiable people, committed as fixtures for the Python face-engine tests. They
have been removed from the working tree and the index. **They remain in Git
history** — see `docs/GIT-HISTORY-REMEDIATION.md` for the decision and the
procedure if removal is warranted.

"Lena" additionally carries its own history: it is a crop of a 1972 Playboy
centrefold, used in imaging research for decades without the subject's meaningful
consent, and the subject has since asked that it be retired. Several journals and
conferences now refuse submissions using it.

## Supplying face fixtures locally

The Python face tests read their fixtures from a directory you provide:

```bash
export FACE_TEST_IMAGES=/path/to/your/faces      # macOS / Linux
$env:FACE_TEST_IMAGES = 'C:\path\to\your\faces'  # Windows
```

Default when unset: `tests/faces-local/`, which is git-ignored. **The tests skip
cleanly when no fixture is present** — they never fail for a missing image, and
they never silently pass either.

Acceptable sources, in order of preference:

1. **Synthetic faces** from a generator that permits this use, with the generator
   and licence recorded below.
2. **Explicitly consented photographs** of colleagues, with written consent
   naming the purpose, the retention period and the withdrawal route.
3. **Properly licensed datasets** whose licence permits software testing —
   check, because many research face datasets explicitly forbid commercial use.

Record provenance for anything you use:

| Fixture | Source | Licence / consent | Obtained by | Date | Expires |
|---|---|---|---|---|---|
| | | | | | |

## UAT evidence

Device screenshots and biometric-trial evidence go in a git-ignored directory
(`docs/uat/uat-evidence/`, or any `**/uat-evidence/` path) while the pass is
running, then move to wherever the organisation keeps personal data under its
retention schedule. Do not attach them to a commit, a pull request or an issue.

## Acceptable committed fixtures

Generated, non-personal data is fine and preferred:

- byte patterns constructed in code (`Buffer.from('%PDF-1.4…')`)
- the EICAR test string for malware-scanner tests — harmless by design and
  recognised by every scanner
- synthetic names, addresses and identifiers that resolve to nobody
- fixed coordinates for geofence tests

## Enforcement

`apps/web/scripts/check-test-data.mjs` scans tracked files for prohibited
fixtures and fails with a non-zero exit code. Run it locally with
`npm run check:test-data`, and wire it into CI ahead of the test job.

It is a safety net, not a substitute for judgement: it catches image files in
test directories and obvious identity-document filenames, and it cannot tell a
synthetic face from a real one.
