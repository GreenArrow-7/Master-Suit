# A request whose body never arrived is refused, so an offline change is not lost on reconnect

**What** — `route()` (`apps/web/src/lib/api/handler.ts`) reads the JSON body as text. If the read fails because the client hung up, or the text is not JSON, it answers 422 before the handler runs, and keeps no Idempotency-Key. An empty body is still `{}`.

**Why** — CI's offline-outbox test failed now and then (19 Oct: the batch, #236 and #232's runs). Two investigations traced it to a real loss path:
1. On reconnecting, the outbox sent a "complete" PATCH, and a page reload cut it off while `route()` was still authenticating.
2. `await req.json().catch(() => ({}))` turned the dead stream into `{}`. Every field of the PATCH is optional, so `{}` passed.
3. The handler ran a no-op, answered 200, and `remember()` stored the key with an empty body's fingerprint.
4. The resend with the real body met a 409, and the outbox dropped it. The follow-up stayed open.

**Where**
- `apps/web/src/lib/api/handler.ts`: `readJsonBody()`.
- `apps/web/tests/sales/idempotency-key.spec.ts`: two cases.

**Behaviour** — A change made offline is applied once the phone is back, even if a reload interrupts the first send. A malformed JSON body now gets 422 instead of being run as an empty change.

**Verified**
- The new cases pass. A body stream that errors gets 422, no key is kept, and the resend under the same key applies. A malformed body gets 422 with no key kept. Both fail on the old handler (tried).
- The unit, integration and security folders pass (143 files, 2196 tests), and tsc is clean.

**Left open** — None.
