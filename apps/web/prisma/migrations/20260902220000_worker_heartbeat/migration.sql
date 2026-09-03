-- Persisted proof that a worker was alive.
--
-- `queueHasWorkers` asks BullMQ who is attached right now. That cannot
-- distinguish a queue nothing has ever drained from one whose worker died an
-- hour ago, and those need different responses — the second is the failure this
-- platform has actually had, with a worker process dead in production for
-- months while producers kept enqueuing.
--
-- One row per (queue, instance), rewritten on a timer. Several replicas may
-- drain one queue, so the instance is part of the key: collapsing them would
-- report green while all but one were dead.
CREATE TABLE "WorkerHeartbeat" (
  "queue"      TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("queue", "instanceId")
);

-- Stale-heartbeat sweeps read this, and they read it by time.
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");
