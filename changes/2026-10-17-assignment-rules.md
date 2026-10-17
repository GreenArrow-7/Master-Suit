# Automatic assignment can be switched on, and is on for new Lead Eagle workspaces

**17 Oct 2026** · feature · Lead Eagle, allocation (audit M7-01, M18-05, PROD-12)

- The round-robin engine existed but nothing created a rule, so every lead waited to be handed out by hand.
- `GET/POST /api/v1/distribution-rules`, `PATCH/DELETE /api/v1/distribution-rules/{id}`: list for `allocation:VIEW`; create, change and delete for `allocation:APPROVE`; pool members must be people the caller may assign to.
- Allocation page: an "Automatic assignment" panel for leaders — rules with on/off and delete, and a form to add one (no people selected = everyone).
- A rule's pool may be `{ everyone: true }`: every active member, in a stable order.
- When Lead Eagle arrives on a workspace with no rule, it gets "Everyone, in turn" (on).
- Test: `tests/sales/distribution-rules.spec.ts`.
