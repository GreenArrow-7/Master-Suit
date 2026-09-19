-- A call audit says which model scored it, so a keyword pass is never shown as a model's judgement.
ALTER TABLE "CallAudit" ADD COLUMN "modelId" TEXT;
