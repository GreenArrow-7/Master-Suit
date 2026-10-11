-- A lead handed back to the allocation queue when its owner is deactivated or
-- removed waits for its own stated reason, not one of the failed-assignment ones.
ALTER TYPE "LeadTriageReason" ADD VALUE IF NOT EXISTS 'OWNER_DEACTIVATED';
