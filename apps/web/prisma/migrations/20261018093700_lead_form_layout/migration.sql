-- The Add lead form as an administrator arranged it (M18-04). Additive: an
-- empty layout is the form as it always was.
ALTER TABLE "OrganizationSetting" ADD COLUMN "leadFormLayout" JSONB NOT NULL DEFAULT '[]';
