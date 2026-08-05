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

Point the web app at it with `FACE_SERVICE_URL`. Unset means face check-in is
unavailable and attendance fails closed with a 503 naming what is missing —
there is no PIN fallback and no degraded mode that lets a punch through.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | `{ready, model, detail}`. `detail` names the missing piece and the command that fixes it. |
| `POST` | `/analyse` | `{frames: [base64]}` → one detection per frame: embedding, pose, detector score, blur, face area. |

Quality failures are returned per frame rather than raised, so the caller learns
which frame failed and why instead of losing the batch.

## Security

Bind it to loopback or an internal network only. A service that turns camera
frames into biometric vectors has no business being reachable from outside. Set
`FACE_SERVICE_TOKEN` and the app will send it as a bearer token; leaving it unset
is for local development on a private network.
