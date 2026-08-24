-- Drop three tables that model features nothing in this codebase implements.
--
-- ── What they are ───────────────────────────────────────────────────────────
--
--   Integration        superseded by IntegrationConnection, which is what every
--                      integration in the product actually uses. No code reads
--                      or writes this one.
--   Webhook            outbound tenant webhooks: a target URL, an event list, a
--   WebhookDelivery    signing secret, a retry count and a delivery log. Fully
--                      modelled, and there is no dispatcher, no way to register
--                      one, and no code path that has ever written a row.
--
-- `WebhookEvent` is a different table and stays: that is the *inbound* log the
-- Meta and telephony webhooks write to, and the retention sweep prunes.
--
-- ── Why drop rather than build ──────────────────────────────────────────────
--
-- Outbound webhooks are a feature — signing, retry policy, per-tenant secrets, a
-- delivery view, somewhere to register one — and building them because the
-- schema is already there is the wrong order. Meanwhile the tables are not inert:
-- `Webhook.signingSecretEnc` reads as a place secrets are kept, so anybody
-- auditing this schema has to work out that nothing puts them there. A model
-- with no implementation is a claim the product makes and does not honour.
--
-- ── The emptiness guard, and why the drop is conditional ────────────────────
--
-- These are empty in every database this migration was written against, and
-- `Webhook`/`WebhookDelivery` cannot be otherwise — no code has ever inserted
-- into them. `Integration` is the one with history: it predates
-- IntegrationConnection, and a deployment that ran an older release might hold
-- rows carrying `configEncrypted`.
--
-- So the drop refuses rather than proceeding if anything is in there. A blocked
-- deployment that says exactly what it found is recoverable in ten minutes;
-- silently destroying a customer's integration configuration is not.
DO $$
DECLARE
  leftover  bigint;
  offenders text := '';
BEGIN
  EXECUTE 'SELECT count(*) FROM "Integration"' INTO leftover;
  IF leftover > 0 THEN offenders := offenders || format('Integration (%s rows) ', leftover); END IF;

  EXECUTE 'SELECT count(*) FROM "WebhookDelivery"' INTO leftover;
  IF leftover > 0 THEN offenders := offenders || format('WebhookDelivery (%s rows) ', leftover); END IF;

  EXECUTE 'SELECT count(*) FROM "Webhook"' INTO leftover;
  IF leftover > 0 THEN offenders := offenders || format('Webhook (%s rows) ', leftover); END IF;

  IF offenders <> '' THEN
    RAISE EXCEPTION
      'Refusing to drop tables that still hold data: %', offenders
      USING HINT =
        'Nothing in the application reads these, so the rows are from a release that predates '
        'IntegrationConnection, or from a direct write. Export them, satisfy yourself they are '
        'not needed, delete them, and run this migration again.';
  END IF;
END $$;

DROP TABLE "WebhookDelivery";
DROP TABLE "Webhook";
DROP TABLE "Integration";
