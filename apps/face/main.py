"""Face compute sidecar. Detection, embedding, pose and image quality — nothing else.

This service holds no state, knows nothing about tenants, employees or
attendance, and never touches the database. It answers one question: "what
faces are in these frames, and what do they look like numerically?"

Every policy decision — which direction the liveness challenge asked for,
whether the pose moved far enough, what match score is good enough, whether
enrolment samples vary enough — lives in the Next.js application next to the
rest of the HR rules, where it is testable in one suite and auditable in one
place. Splitting policy across two languages is how thresholds drift apart.

Why a Python sidecar at all: the buffalo_l ONNX graphs and their preprocessing
already exist and work (see face_engine.py, carried over unchanged from the
original HRMS). Reimplementing SCRFD decoding and ArcFace alignment in
TypeScript would be weeks of work and a new class of bugs for no gain.

It must never be exposed publicly. Bind it to the internal network and set
FACE_SERVICE_TOKEN; the application sends it as a bearer token.
"""
from __future__ import annotations

import base64
import binascii
import os
import sys
import threading
from typing import List, Optional

from tokens import accepts, refusal

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MAX_FRAME_BYTES = 3 * 1024 * 1024

# Fallbacks only. The caller sends the workspace's own thresholds, because what
# counts as an acceptable frame depends on the cameras and lighting in use.
MIN_DET_SCORE = 0.60
MIN_FACE_AREA_RATIO = 0.02   # face must fill 2% of the frame — rejects distant faces
MIN_BLUR_SCORE = 45.0        # variance of Laplacian; low means out of focus, or a screen

app = FastAPI(title="Master SaaS face engine", docs_url=None, redoc_url=None)

_LOCK = threading.Lock()
_ENGINE = None
_LOAD_ERROR: Optional[str] = None


def engine():
    """Lazy singleton. Loading the graphs takes seconds and must not happen per request."""
    global _ENGINE, _LOAD_ERROR
    if _ENGINE is not None:
        return _ENGINE
    if _LOAD_ERROR is not None:
        raise HTTPException(503, _LOAD_ERROR)
    with _LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            from face_engine import FaceEngine
            _ENGINE = FaceEngine()
            return _ENGINE
        except Exception as exc:                      # noqa: BLE001
            _LOAD_ERROR = diagnose(exc)
            raise HTTPException(503, _LOAD_ERROR) from exc


def diagnose(exc: Optional[Exception] = None) -> str:
    """Name the missing piece and the exact command that fixes it.

    "Face recognition isn't available" is useless on its own: opencv missing,
    onnxruntime missing and models-not-downloaded are three different problems
    with three different fixes. There is no PIN fallback, so this message is the
    only thing between an administrator and a system that cannot record
    attendance.
    """
    import importlib.util
    import sys
    from pathlib import Path

    missing = [m for m in ("cv2", "onnxruntime", "numpy") if importlib.util.find_spec(m) is None]
    if missing:
        pretty = {"cv2": "opencv-python-headless"}
        names = ", ".join(pretty.get(m, m) for m in missing)
        return (f'Face engine dependencies are missing ({names}). Run: '
                f'"{sys.executable}" -m pip install -r requirements.txt')

    root = Path(os.environ.get("FACE_MODEL_DIR") or (Path.home() / ".insightface" / "models" / "buffalo_l"))
    absent = [n for n in ("det_10g.onnx", "w600k_r50.onnx") if not (root / n).exists()]
    if absent:
        return (f'The face models are not downloaded (missing {", ".join(absent)} in {root}). '
                f'Run: "{sys.executable}" download_models.py — about 275 MB, one time.')

    return f"The face engine failed to start: {exc}" if exc else "The face engine failed to start."


# Read once, at import, so the refusal below happens at start rather than on the
# first check-in of the day.
_TOKEN = os.environ.get("FACE_SERVICE_TOKEN", "")
_TOKEN_PREVIOUS = os.environ.get("FACE_SERVICE_TOKEN_PREVIOUS", "")
_ENV = os.environ.get("FACE_SERVICE_ENV", "development").strip().lower()

# The rules live in tokens.py, which imports nothing but `hmac`, so
# test_tokens.py can exercise them without loading FastAPI and the ONNX graphs.
# See that module for why a second token exists at all.
_REFUSAL = refusal(_TOKEN, _TOKEN_PREVIOUS, _ENV)
if _REFUSAL:
    sys.stderr.write(f"\n[face] Refusing to start: {_REFUSAL}\n\n")
    raise SystemExit(1)


def authorise(authorization: str = Header(default="")):
    """Shared-secret gate. See tokens.py for the comparison and the rotation."""
    if not accepts(authorization, _TOKEN, _TOKEN_PREVIOUS):
        # Deliberately one message for every refusal. "Bad token" and "no token"
        # and "retired token" are the same answer to a caller who should not be
        # here, and telling them apart is a hint about what to try next.
        raise HTTPException(401, "Bad or missing face-service token.")


class Quality(BaseModel):
    """Frame-acceptance thresholds, supplied per request by the application."""
    minDetectionScore: float = Field(MIN_DET_SCORE, ge=0.0, le=1.0)
    minFaceAreaRatio: float = Field(MIN_FACE_AREA_RATIO, ge=0.0, le=1.0)
    minBlurScore: float = Field(MIN_BLUR_SCORE, ge=0.0)


class AnalyseIn(BaseModel):
    frames: List[str] = Field(..., min_length=1, max_length=10, description="Base64 JPEG/PNG frames")
    quality: Optional[Quality] = None


class Detection(BaseModel):
    ok: bool
    error: Optional[str] = None
    embedding: Optional[List[float]] = None
    detScore: Optional[float] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    bboxAreaRatio: Optional[float] = None
    blurScore: Optional[float] = None


def decode(frame: str) -> bytes:
    payload = frame.split(",", 1)[1] if frame.startswith("data:") else frame
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(422, "A camera frame could not be decoded.") from exc
    if not raw:
        raise HTTPException(422, "An empty camera frame was received.")
    if len(raw) > MAX_FRAME_BYTES:
        raise HTTPException(413, "Camera frames are too large. Lower the capture quality.")
    return raw


def analyse_one(raw: bytes, quality: Quality) -> Detection:
    """One frame in, one detection out. Quality failures are returned, not raised:
    the caller wants to know which frame failed and why, not lose the whole batch."""
    import cv2

    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        return Detection(ok=False, error="That image could not be read. Send a JPEG or PNG frame.")

    faces = engine().get(image)
    if not faces:
        return Detection(ok=False, error="No face found in the frame. Move into the light and centre your face.")
    if len(faces) > 1:
        return Detection(ok=False, error="More than one face in the frame. Make sure you are alone in shot.")

    face = faces[0]
    if face.det_score < quality.minDetectionScore:
        return Detection(ok=False, error="The face was not clear enough. Move closer and try again.")

    height, width = image.shape[:2]
    x1, y1, x2, y2 = face.bbox
    area_ratio = max(0.0, (x2 - x1) * (y2 - y1)) / float(width * height)
    if area_ratio < quality.minFaceAreaRatio:
        return Detection(ok=False, error="You are too far from the camera. Move closer.")

    crop = image[max(int(y1), 0):max(int(y2), 0), max(int(x1), 0):max(int(x2), 0)]
    blur = 0.0
    if crop.size:
        blur = float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    if blur < quality.minBlurScore:
        return Detection(ok=False, error="The image is blurry. Hold the camera steady and try again.")

    pitch, yaw, roll = face.pose if face.pose is not None else (0.0, 0.0, 0.0)
    return Detection(
        ok=True,
        embedding=[float(v) for v in np.asarray(face.normed_embedding, dtype=np.float32)],
        detScore=float(face.det_score),
        yaw=float(yaw), pitch=float(pitch), roll=float(roll),
        bboxAreaRatio=float(area_ratio), blurScore=blur,
    )


@app.get("/health")
def health():
    try:
        engine()
        return {"ready": True, "model": "buffalo_l", "detail": "Face check-in is available."}
    except HTTPException as exc:
        return {"ready": False, "model": "buffalo_l", "detail": exc.detail}


@app.post("/analyse", dependencies=[Depends(authorise)])
def analyse(body: AnalyseIn):
    quality = body.quality or Quality()
    frames = [decode(frame) for frame in body.frames]
    return {"detections": [analyse_one(raw, quality).model_dump() for raw in frames]}
