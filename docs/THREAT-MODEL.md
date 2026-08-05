# Threat model

Primary assets are employee/biometric records, sales/customer data, recordings,
credentials, tenant configuration and audit evidence. Primary threat actors are
external attackers, malicious tenant users, compromised administrators, spoofed
integration providers and support personnel with excessive access.

Key boundaries are browser-to-edge, edge-to-service, service-to-database,
worker queues, object storage and third-party webhooks. Required controls include
mandatory MFA, scoped membership, backend entitlements, per-record permissions,
RLS, signed/replay-protected webhooks, encrypted storage, immutable audit events,
rate limiting, secure recovery and operator separation.

The largest current residual risks are separate identity stores and inactive RLS.
