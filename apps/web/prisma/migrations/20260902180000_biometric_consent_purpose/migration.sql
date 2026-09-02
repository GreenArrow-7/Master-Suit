-- Biometric consent gets an explicit purpose.
--
-- `BiometricConsent` recorded that an employee consented to face data and not
-- what they consented to it being used *for*. Enforcement was already correct —
-- enrolment and both check-in paths refuse without an active row — but the row
-- itself was a general-purpose permission slip. The day face is wired to
-- anything else (door access, workstation unlock, signing in to Master-Suit
-- itself), that consent would silently cover it, on a decision the employee
-- made about clocking in.
--
-- Naming the purpose makes a new use require a new consent.
CREATE TYPE "BiometricConsentPurpose" AS ENUM ('ATTENDANCE_FACE_VERIFICATION');

ALTER TABLE "BiometricConsent"
  ADD COLUMN "purpose" "BiometricConsentPurpose" NOT NULL DEFAULT 'ATTENDANCE_FACE_VERIFICATION',
  -- The consent wording shown, distinct from the privacy policy in force: the
  -- text can be reworded without the policy changing, and "what were they told?"
  -- is the question an audit actually asks.
  ADD COLUMN "consentVersion" TEXT,
  -- Non-biometric context for the audit trail. Never face data.
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- Existing rows are attendance consents and nothing else: the only code that
-- has ever created one is grantConsent in services/hr/attendance.ts, and the
-- only code that reads one gates face enrolment and the two attendance punch
-- paths. Stamping them explicitly preserves exactly the access they grant today
-- rather than relying on the column default to mean the same thing.
UPDATE "BiometricConsent" SET "purpose" = 'ATTENDANCE_FACE_VERIFICATION';

CREATE INDEX "BiometricConsent_tenantId_employeeId_purpose_idx"
  ON "BiometricConsent"("tenantId", "employeeId", "purpose");
