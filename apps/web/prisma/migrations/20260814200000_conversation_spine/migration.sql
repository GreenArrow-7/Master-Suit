-- Conversation spine: threads Communication rows into one exchange per customer
-- per channel, so Meta, Instagram, WhatsApp and Website messages can share a
-- customer timeline instead of each provider growing its own message store.

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED');

CREATE TABLE "Conversation" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "channel"       "ChannelType" NOT NULL,
  "providerKey"   TEXT,
  "externalId"    TEXT NOT NULL,
  "displayName"   TEXT,
  "leadId"        TEXT,
  "contactId"     TEXT,
  "accountId"     TEXT,
  "opportunityId" TEXT,
  "ownerId"       TEXT,
  "status"        "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "lastMessageAt" TIMESTAMP(3),
  "unreadCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Communication" ADD COLUMN "conversationId" TEXT;

-- The thread key, and the idempotency key with it: a redelivered inbound webhook
-- resolves to this row rather than opening a second thread. Scoped by tenant so
-- two workspaces messaging the same customer never collide.
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalId_key"
  ON "Conversation"("tenantId", "channel", "externalId");

CREATE INDEX "Conversation_tenantId_status_lastMessageAt_idx"
  ON "Conversation"("tenantId", "status", "lastMessageAt" DESC);
CREATE INDEX "Conversation_tenantId_ownerId_status_idx"
  ON "Conversation"("tenantId", "ownerId", "status");
CREATE INDEX "Conversation_tenantId_leadId_idx"
  ON "Conversation"("tenantId", "leadId");
-- Cursor pagination for the message pane: newest first, older fetched on scroll.
CREATE INDEX "Communication_tenantId_conversationId_createdAt_idx"
  ON "Communication"("tenantId", "conversationId", "createdAt" DESC);

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Layer 3 of the tenant defence. Without FORCE the owning role reads every
-- tenant's threads regardless of policy, and lib/startup-check.ts refuses to boot
-- on exactly that condition.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['Conversation'];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ') '
      'WITH CHECK ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ')',
      target
    );
  END LOOP;
END $$;
