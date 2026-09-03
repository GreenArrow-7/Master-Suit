# Face compute sidecar

Detection, embedding, pose and image quality. Nothing else.

This service holds no state, knows nothing about tenants, employees or
attendance, and never touches the database. Every policy decision — which
direction the liveness challenge asked for, whether the pose moved far enough,
what match score is good enough, whether enrolment samples vary enough — lives in
the Next.js app (`src/services/hr/face.ts`), next to the rest of the HR rules.

`face_engine.py` is carried over unchanged from the original HRMS. It runs the
two buffalo_l ONNX graphs directly rather than importing `insightface`, whose
Cython mesh renderer we never call but which pip insists on compiling — that is
the difference between an install that needs no C++ compiler on any platform and
one that needs a 7 GB toolchain.

## Running it

```bash
docker compose -f ../web/infra/docker-compose.yml up -d face
```

First boot downloads the buffalo_l pack (~275 MB) into the `facemodels` volume,
so it survives image rebuilds. The health check allows five minutes for that.

Without Docker — every dependency has a prebuilt wheel on every platform we
support, so this needs no compiler:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python download_models.py          # ~275 MB, once
FACE_SERVICE_TOKEN=<secret> .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8081
```

Point the web app at it with `FACE_SERVICE_URL`. Unset means face check-in is
unavailable and attendance fails closed with a 503 naming what is missing —
there is no PIN fallback and no degraded mode that lets a punch through.

## Verifying that it actually matches faces

`/health` answering `ready: true` says the graphs loaded. It does not say the
engine separates people, which is the only thing it exists to do.

```bash
cd ../web
npx tsx scripts/verify-face-matching.ts <same-person-a> <same-person-b> <someone-else>
```

Two photographs of one person in different head poses, and one of somebody else.
The script drives the application's own client and matching code — `analyse`,
`cosine`, `bestMatch`, `verifyLiveness` from `src/services/hr/face.ts` — so what
it scores is the path a check-in takes, not a reimplementation of it. It prints
the cosine on each pair against `FACE_MATCH_THRESHOLD`, runs each liveness
challenge, and exits non-zero if the same person is refused, a different person
is accepted, a movement that did not happen passes, or a face substituted
mid-challenge gets through.

It is not part of CI and is not meant to be: it needs the sidecar running, the
275 MB of graphs downloaded, and photographs of real people. The rules it
depends on — the cosine maths, the template round trip, the challenge
directions, the spread threshold — are pinned with synthetic vectors in
`apps/web/tests/hr/attendance.spec.ts`, which does run in CI. This script is the
other half: whether the engine underneath those rules works on real faces.

## Endpoints

| Method | Path       | Purpose                                                                                           |
| ------ | ---------- | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`  | `{ready, model, detail}`. `detail` names the missing piece and the command that fixes it.         |
| `POST` | `/analyse` | `{frames: [base64]}` → one detection per frame: embedding, pose, detector score, blur, face area. |

Quality failures are returned per frame rather than raised, so the caller learns
which frame failed and why instead of losing the batch.

## Security

Bind it to loopback or an internal network only. A service that turns camera
frames into biometric vectors has no business being reachable from outside.

`FACE_SERVICE_TOKEN` is the shared secret the application sends as a bearer
token. It is compared with `hmac.compare_digest`, not `!=`: a byte-by-byte
comparison returns as soon as two bytes differ, and the time it takes to refuse
tells the caller how much of the prefix was right — enough, over many requests,
to recover the token a byte at a time.

Leaving the token unset is for local development, and only local development.
`FACE_SERVICE_ENV` says which this is: anything other than `development` makes
the process **refuse to start** without a token rather than accepting every
caller silently, which is what it used to do. The compose files set it —
`development` in the base file, `production` in the Azure overlay.

### Rotating the token

`FACE_SERVICE_TOKEN_PREVIOUS` holds the token being retired, and is accepted
alongside the current one for as long as it is set. It exists because rotating a
single shared value means a window in which the application is sending a token
this service no longer accepts — every check-in a 401, nobody able to start
their shift. The honest consequence was that the token never got rotated.

Three ordered steps, no window:

1. **face** — `FACE_SERVICE_TOKEN=<new>`, `FACE_SERVICE_TOKEN_PREVIOUS=<old>`,
   restart. Both are accepted; the application is still sending `<old>`.
2. **web** — `FACE_SERVICE_TOKEN=<new>`, restart. Now sending `<new>`.
3. **face** — clear `FACE_SERVICE_TOKEN_PREVIOUS`, restart. `<old>` is dead.

`apps/web/scripts/rotate-face-token.sh <env-file>` does all three, and refuses to
start a rotation while one is already in progress. Step 3 is not optional: a
previous token left set is a second live credential nobody is watching, which is
most of what the rotation was for. The service refuses to start if the two
variables hold the same value, which is a rotation that rotated nothing.

The comparison checks both candidates every time and combines the results
afterwards rather than returning on the first match — a short-circuit would make
a request accepted by the current token measurably faster than one accepted by
the previous token, which is a timing signal about which credential the caller
holds.

`python3 apps/face/test_tokens.py` exercises all of it, and runs in CI. It
imports `tokens.py`, which pulls in `hmac` and nothing else, so checking the gate
does not mean loading FastAPI and the ONNX graphs.
