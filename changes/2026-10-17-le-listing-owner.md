# A Lead-Eagle-only workspace can record an owner and create a listing

**17 Oct 2026** · fix · Lead Eagle, listings (audit PLAT-12, M12-01, M12-03)

- `GET/POST /api/v1/owners` were Sales-only, and no screen recorded an owner, so a Lead-Eagle-only workspace could never create a listing. Both now admit every lead module (LEAD_MODULES).
- New listing with no owner yet shows an "Add owner" form (name, phone, email) instead of a dead end; saving it opens the listing form.
- Test: `tests/permission/module-entitlement.spec.ts` — a Lead-Eagle-only workspace records and reads an owner.
