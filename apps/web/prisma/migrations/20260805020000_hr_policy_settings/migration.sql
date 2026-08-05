-- Workspace-editable HR policy. Only overridden keys are stored, so product
-- and statutory defaults still reach workspaces that never changed them.

-- AlterTable
ALTER TABLE "OrganizationSetting" ADD COLUMN     "hrPolicy" JSONB NOT NULL DEFAULT '{}';

