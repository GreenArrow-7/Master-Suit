# An untouched lead at its SLA tells the manager, and can be handed on

**17 Oct 2026** · feature · Lead Eagle, allocation (audit M7-08, M7-09)

- At `slaDueAt` with no first contact, the lead was marked BREACHED and an automation event fired — which a Lead-Eagle-only workspace cannot configure, so nobody heard.
- Now the owner's reporting manager gets a `lead.sla_breached` notice (bell and push), once.
- When the active assignment rule has "re-assign after" set, the lead is released (audited OWNER_CHANGED) and goes back through the rotation.
- Known ceiling: the check runs once, at the SLA time, so "re-assign after N minutes" means "re-assign on breach".
- Test: `tests/sales/sla-escalation.spec.ts`.
