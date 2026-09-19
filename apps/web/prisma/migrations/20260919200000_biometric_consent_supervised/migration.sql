-- Supervised biometric consent: HR records it with the employee present, who signs by typing their name.
ALTER TABLE "BiometricConsent" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "BiometricConsent" ADD COLUMN "attestation" TEXT;
