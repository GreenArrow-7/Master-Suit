-- §59 wants the fact that an agent replied to a customer on the audit trail.
--
-- The event only, never the message body: the audit hook records the method,
-- path and record id and nothing from the request, so the text stays in
-- Communication where the retention policy can reach it. Duplicating every
-- WhatsApp message into the audit log would put the most sensitive data in the
-- product into the one table nobody prunes.
ALTER TYPE "AuditEvent" ADD VALUE IF NOT EXISTS 'MESSAGE_SENT';
