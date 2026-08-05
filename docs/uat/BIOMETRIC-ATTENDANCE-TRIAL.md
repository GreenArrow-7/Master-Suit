# Controlled real-staff attendance trial

**Status: NOT STARTED. No human has been through this pipeline.**

Face check-in is code-complete and every surrounding control is verified against
the live database and the real ONNX models — engine health, consent gating,
enrolment gating, geofence, GPS-accuracy ceiling, sequence rules, offline
deduplication, liveness fixtures, capture encryption and consent-withdrawal
deletion. **What has never happened is detection → embedding → match on an actual
human face.** No automated check can substitute for that, and biometric
attendance must not be described as production-ready until this trial is done.

## Before anyone is asked to take part

| # | Prerequisite | Owner | Done |
|---|---|---|---|
| P1 | Written privacy notice issued, in English and Arabic, naming what is stored (a 512-number template, not a photograph), the encrypted capture frame, the retention period and who can see it | HR / Legal | ☐ |
| P2 | UAE PDPL basis for biometric processing confirmed by counsel | Legal | ☐ |
| P3 | Non-biometric alternative agreed and documented, so participation is genuinely optional | HR | ☐ |
| P4 | `captureRetentionDays` set deliberately for the trial and recorded here: ______ | HR admin | ☐ |
| P5 | `FACE_MATCH_THRESHOLD` starting value recorded here: ______ (default 0.55) | HR admin | ☐ |
| P6 | HTTPS in place — camera access is refused on a plain LAN address | Ops | ☐ |
| P7 | Volunteers briefed that they may withdraw at any point, and that withdrawal deletes their templates immediately | HR | ☐ |

**Do not proceed if any prerequisite is unticked.** Collecting biometrics
without P1–P3 is the kind of failure that is not fixable afterwards.

## Participants

Minimum ten volunteers, deliberately varied: skin tone, glasses, beards, head
coverings, height. A trial run entirely on people who resemble each other will
produce a threshold that fails for everyone else.

| # | Employee | Consent recorded | Enrolment date | Withdrawn |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| … | | | | |

## Scenarios

| ID | Scenario | Expected | Result | Evidence | Tester | Date |
|---|---|---|---|---|---|---|
| A1 | Consent granted through the UI | Consent row recorded with timestamp and policy version | | | | |
| A2 | Enrolment with four varied angles | Accepted; spread above the configured minimum | | | | |
| A3 | Enrolment with four identical poses | **Refused** — samples too similar | | | | |
| A4 | Enrolment before consent | **Refused** | | | | |
| A5 | Camera permission denied | App explains; no silent failure | | | | |
| A6 | Camera permission granted then revoked mid-session | Handled without a hang | | | | |
| A7 | Check-in, good light, inside geofence | Accepted; day record shows the check-in | | | | |
| A8 | Check-in, poor light (dim lobby, back-lit doorway) | Either accepted or a clear "move into the light" refusal — never a wrong-person match | | | | |
| A9 | Check-in, face partly covered (mask, sunglasses) | Refused with a usable message | | | | |
| A10 | **Wrong person attempts check-in** as an enrolled colleague | **Refused.** This is the single most important row in this document | | | | |
| A11 | Held-up photograph of an enrolled employee | **Refused** by liveness | | | | |
| A12 | Video replay on a phone screen | Expected to be refused, **but this is a known weakness** — record honestly whether it succeeded | | | | |
| A13 | Check-in outside the geofence | Refused, with the measured distance | | | | |
| A14 | Check-in with poor GPS accuracy | Refused on accuracy, not measured as outside | | | | |
| A15 | Check-out at the same location | Accepted; worked minutes roll up correctly | | | | |
| A16 | Check-out at a different location | Refused under the same-location rule | | | | |
| A17 | Second check-in without checking out | Refused as already checked in | | | | |
| A18 | Attendance exception raised after a failed check-in | Reaches the manager, then HR; approval writes a corrected punch | | | | |
| A19 | Non-biometric alternative used by a non-participant | Attendance recorded without any biometric processing | | | | |
| A20 | Audit log inspected after the above | Every attempt, accepted and refused, appears with actor and outcome | | | | |
| A21 | Consent withdrawn by a participant | Templates deleted immediately; check-in blocked afterwards | | | | |
| A22 | Retention verified | Capture frames older than the configured window are gone after the retention job runs | | | | |

## Threshold tuning

Do not adjust `FACE_MATCH_THRESHOLD` on impressions. After at least a week:

1. Export the match scores from the attendance review queue.
2. Plot genuine attempts against the one deliberate impostor attempt (A10).
3. Choose a threshold with visible separation between the two.
4. Record the before/after values and who approved the change.

**Lowering the threshold to stop complaints is how you end up accepting the wrong
person.** If genuine staff are being rejected, the first response is better
enrolment or better lighting, not a lower bar.

| Date | Old value | New value | Reason | Approved by |
|---|---|---|---|---|
| | | | | |

## Outcome

Biometric attendance may be described as production-ready only when A1–A22 are
complete with evidence, A10 and A11 refused, and the threshold has been tuned on
real score data.

| Role | Name | Date | Signature |
|---|---|---|---|
| HR lead | | | |
| Privacy / legal | | | |
| Engineering | | | |
