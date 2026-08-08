# Connecting a telephony vendor, and making the first call

Four vendors are implemented behind one interface: Twilio, Exotel, Knowlarity and
Plivo. A workspace connects one or more and names one as its default; employees
never choose. Everything below is done at
`/{workspaceSlug}/admin/integrations` and in the vendor's own console.

**No live account has yet placed a call through this application.** The adapters
are written against the vendors' documented APIs and covered by
`tests/security/telephony-vendors.spec.ts` (signatures, status normalisation) and
`tests/integration/telephony-webhook-flow.spec.ts` (the whole callback lifecycle
through the real route). Treat the first call on each vendor as an integration
test and run it deliberately, using the procedure at the end of this document.

---

## What the platform needs from every vendor

| | |
|---|---|
| **A virtual number** | The caller ID the client sees. Entered as *Caller ID / virtual number* in E.164, e.g. `+971500000000`. |
| **API credentials** | Per vendor, below. Encrypted with AES-256-GCM before storage and never returned by any API — not masked, not partially. |
| **A callback URL** | Shown on the provider card once connected. Paste it into the vendor's console verbatim, including the query string. |

Every call is **click-to-call**: the platform rings the employee's own handset
first, then bridges the client when they answer. The employee's number comes from
`phone` on their user record. A caller with no number on file is told to add one
rather than being silently dialled from somewhere else.

---

## Twilio

**Credentials** — Console → Account Info.

- `Account SID` (starts with `AC`)
- `Auth token`

**Console setup** — none beyond the number. Twilio is told the callback URL on
every request, so nothing has to be configured in advance.

**Signature** — `X-Twilio-Signature`, HMAC-SHA1 over the URL plus the POST
parameters in key order. This is why `APP_URL` must be the externally reachable
origin: the signature covers the URL Twilio was given, and a proxy that rewrites
the host will break it. That is correct behaviour, not something to work around.

**Capabilities** — outbound, click-to-call, recording, status polling, hang-up,
signed webhooks. The full set.

---

## Plivo

**Credentials** — Console → Account → Keys & Credentials.

- `Auth ID` (starts with `MA`)
- `Auth token`

**Console setup** — none. Plivo receives `answer_url`, `ring_url` and
`hangup_url` on every request.

**Signature** — `X-Plivo-Signature-V3` with `…-Nonce`, HMAC-SHA256 over the URL
plus the nonce. The body is *not* signed. Multiple comma-separated signatures are
accepted so a key rotation does not drop callbacks.

**Capabilities** — outbound, click-to-call, recording, signed webhooks.
**Not** hang-up or status polling: Plivo's create call returns a `RequestUUID`,
while those two APIs need the `CallUUID` it only reveals later. The UI hides both
buttons rather than offering one that fails.

**Call control** — Plivo has no inline equivalent of Twilio's `Twiml` parameter,
so the platform serves the bridge document itself at
`…/webhooks/telephony/{key}/answer?call={callId}`. The client's number is read
from the call record, never taken from the query string, so the endpoint cannot
be turned into an open relay that dials an arbitrary number on your account.

---

## Exotel

**Credentials** — Console → Settings → API Settings.

- `Account SID`
- `API key`
- `API token`
- `API subdomain` — `api.exotel.com`, or your regional one (`@singapore…`). Both
  the bare host and a full URL are accepted.

**Console setup** — the *ExoPhone* you enter as the caller ID must be one your
account owns. Callbacks are passed per request as `StatusCallback`.

**Signature — there is none.** Exotel does not sign its callbacks. The endpoint
is authenticated by two secrets in the URL: the unguessable connection key in the
path, and a derived `token` query parameter compared in constant time. **Copy the
callback URL complete with `?token=…`** — without it every callback is rejected
with a 401, which looks exactly like a call that never completed.

This is weaker than a signature: it proves the caller knows a secret, not that
the body is untampered. Restrict the endpoint to Exotel's published source
addresses at your edge or load balancer if the deployment allows it.

**Capabilities** — outbound, click-to-call, recording, status polling.
**Not** hang-up.

**Body format** — Exotel's classic callback is form-encoded and its newer one is
JSON, and its documentation is inconsistent about key casing. The adapter accepts
either and reads keys case-insensitively, so no configuration choice here is
wrong.

---

## Knowlarity

**Credentials** — Console → Settings → API.

- `SR number (K-number)` — the virtual number, in E.164
- `x-api-key`
- `Authorization token`

**Console setup** — Knowlarity has **no per-request callback parameter**. The
callback URL is set once, on the account, in their panel. Paste the URL from the
provider card — again **including `?token=…`** — into the call-status callback
field there. Nothing will arrive until you do.

**Signature — there is none**, same as Exotel, with the same URL-token
authentication and the same recommendation to restrict by source address.

**Capabilities** — outbound, click-to-call, recording. **Not** hang-up or status
polling: their call-log API is paginated by date range with no lookup by call id,
so a single-call poll would mean scanning a day of logs.

**Verification** — Knowlarity has no read-only endpoint, so *Save and verify*
cannot contact them. The connection saves and reports **unverified**; the first
real call is the test. This is stated rather than hidden behind a green badge.

---

## Making the first call, deliberately

Do this once per vendor, with a colleague, before any of it touches a client.

1. **Connect the vendor** and press *Save and verify*. Twilio, Plivo, Exotel and
   the WhatsApp and Google connections all make a live authenticated read at this
   point; a wrong key fails here rather than mid-conversation. Knowlarity will
   report unverified — expected.
2. **Paste the callback URL** into the vendor's console (Exotel and Knowlarity
   only; Twilio and Plivo need nothing).
3. **Select it as the default calling provider.** A workspace with two connected
   vendors and no default is refused at dial time rather than guessed at.
4. **Put your own mobile number on your user record.** That is the handset the
   platform will ring.
5. **Create a lead whose number is a colleague's mobile**, open it, record
   consent if you want the call recorded, and dial.
6. **Watch for, in order:**
   - your own phone rings — the outbound leg worked, so credentials and the
     caller ID are right;
   - answering it rings your colleague — the bridge worked;
   - the call record moves `RINGING → IN_PROGRESS → COMPLETED` with a duration —
     status callbacks are arriving and are authenticating;
   - a `Recording` row appears and its `storageBucket` clears from `provider` to
     null within a minute — the ingest worker is running and pulled the media
     into your own object storage.
7. **If the call connects but the record stays `RINGING`**, the callbacks are not
   reaching you or not authenticating. Check `APP_URL` matches the externally
   reachable origin, and for Exotel and Knowlarity check the `?token=` survived
   the copy.
8. **If the recording never leaves `provider`**, the `media` worker is not
   running. `npm run worker` starts it, along with the `ai` worker that produces
   the transcript, summary and audit after it.

## What breaks a working setup

- **Changing `APP_URL`** invalidates every stored callback URL and breaks
  Twilio's and Plivo's signatures. Re-copy the URLs from the provider cards.
- **Rotating `WEBHOOK_SIGNING_PEPPER`** changes the derived Exotel and Knowlarity
  URL tokens, and every RSVP link, at once. That is the intended revocation
  lever, but it is not a quiet one.
- **Disconnecting a provider** deletes its row and retires its webhook key, so
  callbacks in flight for it stop authenticating. If it was the default, the
  default is cleared too rather than left pointing at nothing.
