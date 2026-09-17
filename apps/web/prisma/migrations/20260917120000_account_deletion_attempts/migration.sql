-- How many times the executor has claimed a request. The sweep stops retrying past a
-- cap so a persistently failing erasure cannot hold a batch slot indefinitely.
ALTER TABLE "AccountDeletionRequest" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
