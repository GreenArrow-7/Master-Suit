-- A reset acts on PlatformUser.passwordHash, so the token names that identity.
-- tenantId/userId become optional: the platform owner exists before any
-- workspace does and must still be able to reset a forgotten password.

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "platformUserId" TEXT,
ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "PasswordResetToken_platformUserId_idx" ON "PasswordResetToken"("platformUserId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
