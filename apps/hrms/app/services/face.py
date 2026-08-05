"""Server-side face detection, embedding and liveness.

Why server-side: if the client computes the embedding, a punch is just a vector
in a JSON body. Capture one once and you can replay it from anywhere, forever.
The camera frame must be processed where the client can't reach it.

Liveness here is challenge-response: the server picks a head turn at random,
the client sends a short burst of frames, and we verify the pose actually moved
in the requested direction while staying the same person. That defeats a held-up
photo and a static screen. It is NOT a certified presentation-attack detection
system — a determined attacker with a video replay on a good screen can still
get through. If you need iBeta-certified PAD, buy it; don't build it.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Literal, Optional, Sequence

import numpy as np

Direction = Literal["left", "right", "up"]

_MODEL_LOCK = threading.Lock()
_ANALYSER = None
_LOAD_ERROR: Optional[str] = None


class FaceEngineUnavailable(RuntimeError):
    """Raised when models aren't present. We fail closed — never wave a punch through."""


def _analyser():
    """Lazy singleton. Model load takes seconds and must not happen per request."""
    global _ANALYSER, _LOAD_ERROR
    if _ANALYSER is not None:
        return _ANALYSER
    if _LOAD_ERROR is not None:
        raise FaceEngineUnavailable(_LOAD_ERROR)

    with _MODEL_LOCK:
        if _ANALYSER is not None:
            return _ANALYSER
        try:
            from app.services.face_engine import FaceEngine
            _ANALYSER = FaceEngine()
            return _ANALYSER
        except ImportError as e:
            _LOAD_ERROR = diagnose()
            raise FaceEngineUnavailable(_LOAD_ERROR) from e
        except Exception as e:                      # noqa: BLE001
            _LOAD_ERROR = f"{diagnose()}\n\nUnderlying error: {e}"
            raise FaceEngineUnavailable(_LOAD_ERROR) from e


def diagnose() -> str:
    """Say exactly which piece is missing and the exact command to fix it.

    "Face recognition isn't installed" is useless on its own: opencv missing,
    onnxruntime missing and models-not-downloaded are three different problems
    with three different fixes. There is no PIN fallback any more, so this
    message is the only thing standing between an administrator and a system
    that cannot record attendance.
    """
    import importlib.util
    import sys
    from pathlib import Path

    # Quote the interpreter path: on Windows it usually contains spaces, and a
    # bare `pip` frequently belongs to a DIFFERENT Python than the one running
    # this server. That is the single most common reason an install "succeeds"
    # and the server still reports the package missing. Naming the exact
    # interpreter removes the ambiguity.
    py = f'"{sys.executable}"'

    missing = [m for m in ("cv2", "onnxruntime", "numpy")
               if importlib.util.find_spec(m) is None]
    if missing:
        pretty = {"cv2": "opencv-python-headless"}
        names = ", ".join(pretty.get(m, m) for m in missing)
        return ("Face recognition isn't installed on this server "
                f"(missing: {names}).\n\n"
                "Run these with THIS interpreter - a bare 'pip' often belongs "
                "to a different Python installation, which is why an install "
                "can appear to succeed while the server still sees nothing:\n\n"
                f"    {py} -m pip install -r requirements-face.txt\n"
                f"    {py} scripts/download_models.py\n\n"
                "No C++ compiler is needed. Restart the API afterwards.\n"
                f"Interpreter: {sys.executable}")

    try:
        from app.services.face_engine import model_root
        root = model_root()
    except Exception:                                # noqa: BLE001
        root = Path.home() / ".insightface" / "models" / "buffalo_l"

    absent = [n for n in ("det_10g.onnx", "w600k_r50.onnx")
              if not (root / n).exists()]
    if absent:
        return ("The face recognition models haven't been downloaded "
                f"(missing {', '.join(absent)} in {root}).\n\n"
                f"    {py} scripts/download_models.py\n\n"
                "About 275 MB, one time. Restart the API afterwards.")

    return ("Face recognition is installed but failed to start. Check the API "
            "log for the underlying error.")


def _cv2():
    """OpenCV lives in the optional face extra. Importing it directly would raise
    ModuleNotFoundError and surface as a 500; callers expect FaceEngineUnavailable
    so the API can answer 503 with a message that says how to fix it."""
    try:
        import cv2
        return cv2
    except ImportError as e:
        raise FaceEngineUnavailable(diagnose()) from e


def engine_ready() -> bool:
    try:
        _analyser()
        return True
    except FaceEngineUnavailable:
        return False


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------
@dataclass
class DetectedFace:
    embedding: np.ndarray
    det_score: float
    yaw: float
    pitch: float
    roll: float
    bbox_area_ratio: float
    blur_score: float


MIN_DET_SCORE = 0.60
MIN_FACE_AREA_RATIO = 0.02      # face must fill 2% of frame — rejects distant faces
MIN_BLUR_SCORE = 45.0           # variance of Laplacian; low = out of focus or a screen


def decode_image(data: bytes) -> np.ndarray:
    cv2 = _cv2()
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("That image couldn't be read. Send a JPEG or PNG frame.")
    return img


def analyse(image: np.ndarray) -> DetectedFace:
    cv2 = _cv2()

    faces = _analyser().get(image)
    if not faces:
        raise ValueError("No face found in the frame. Move into the light and centre your face.")
    if len(faces) > 1:
        raise ValueError("More than one face in the frame. Make sure you're alone in shot.")

    f = faces[0]
    if f.det_score < MIN_DET_SCORE:
        raise ValueError("The face wasn't clear enough. Move closer and try again.")

    h, w = image.shape[:2]
    x1, y1, x2, y2 = f.bbox
    area_ratio = max(0.0, (x2 - x1) * (y2 - y1)) / float(w * h)
    if area_ratio < MIN_FACE_AREA_RATIO:
        raise ValueError("You're too far from the camera. Move closer.")

    crop = image[max(int(y1), 0):max(int(y2), 0), max(int(x1), 0):max(int(x2), 0)]
    blur = 0.0
    if crop.size:
        blur = float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY),
                                   cv2.CV_64F).var())
    if blur < MIN_BLUR_SCORE:
        raise ValueError("The image is blurry. Hold the camera steady and try again.")

    pose = getattr(f, "pose", None)
    pitch, yaw, roll = (float(pose[0]), float(pose[1]), float(pose[2])) if pose is not None \
        else (0.0, 0.0, 0.0)

    return DetectedFace(embedding=np.asarray(f.normed_embedding, dtype=np.float32),
                        det_score=float(f.det_score), yaw=yaw, pitch=pitch, roll=roll,
                        bbox_area_ratio=area_ratio, blur_score=blur)


# ---------------------------------------------------------------------------
# Challenge-response liveness
# ---------------------------------------------------------------------------
CHALLENGE_TTL_SECONDS = 90
YAW_THRESHOLD = 12.0     # degrees of head turn required
PITCH_THRESHOLD = 10.0
SAME_PERSON_THRESHOLD = 0.40   # frames must be the same face, or it's a swap attack


@dataclass
class Challenge:
    nonce: str
    employee_id: int
    direction: Direction
    issued_at: float = field(default_factory=time.time)
    used: bool = False


class ChallengeStore:
    """In-process store. Move to Redis if you run more than one worker."""

    def __init__(self):
        self._items: dict[str, Challenge] = {}
        self._lock = threading.Lock()

    def issue(self, employee_id: int) -> Challenge:
        direction: Direction = secrets.choice(["left", "right", "up"])
        ch = Challenge(nonce=secrets.token_urlsafe(24), employee_id=employee_id,
                       direction=direction)
        with self._lock:
            self._prune_locked()
            self._items[ch.nonce] = ch
        return ch

    def consume(self, nonce: str, employee_id: int) -> Challenge:
        """Single use. A replayed nonce is rejected even inside the TTL."""
        with self._lock:
            self._prune_locked()
            ch = self._items.get(nonce)
            if not ch or ch.employee_id != employee_id:
                raise ValueError("That check-in attempt expired. Start again.")
            if ch.used:
                raise ValueError("That check-in attempt was already used. Start again.")
            ch.used = True
            return ch

    def _prune_locked(self):
        cutoff = time.time() - CHALLENGE_TTL_SECONDS
        for k in [k for k, v in self._items.items() if v.issued_at < cutoff]:
            self._items.pop(k, None)


challenges = ChallengeStore()


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@dataclass
class LivenessResult:
    passed: bool
    score: float
    reason: str
    embedding: Optional[np.ndarray] = None


def verify_liveness(frames: Sequence[bytes], direction: Direction) -> LivenessResult:
    """frames[0] is the neutral pose, the rest are after the requested movement.

    Checks, in order of how cheaply they fail:
      1. every frame contains exactly one usable face
      2. all frames are the same person
      3. the head actually moved in the requested direction
      4. the frames are not byte-identical (a resent still image)
    """
    if len(frames) < 2:
        raise ValueError("Send at least two frames: one neutral, one after moving.")
    if len({bytes(f) for f in frames}) < len(frames):
        return LivenessResult(False, 0.0, "Identical frames — send live camera frames.")

    detections = [analyse(decode_image(f)) for f in frames]
    base = detections[0]

    for d in detections[1:]:
        if cosine(base.embedding, d.embedding) < SAME_PERSON_THRESHOLD:
            return LivenessResult(False, 0.0, "The face changed between frames.")

    moved = detections[-1]
    if direction == "left":
        delta = moved.yaw - base.yaw
        ok = delta >= YAW_THRESHOLD
    elif direction == "right":
        delta = base.yaw - moved.yaw
        ok = delta >= YAW_THRESHOLD
    else:  # up
        delta = base.pitch - moved.pitch
        ok = abs(delta) >= PITCH_THRESHOLD

    if not ok:
        return LivenessResult(False, 0.0,
                              f"Head movement not detected. Turn your head {direction} "
                              "and hold for a moment.")

    # Score blends detector confidence and image sharpness — a printed photo or a
    # phone screen usually loses on sharpness even when it passes the pose check.
    score = min(1.0, (base.det_score * 0.6) + min(base.blur_score / 300.0, 1.0) * 0.4)
    return LivenessResult(True, round(score, 3), "ok", embedding=base.embedding)


def embed_for_enrolment(frames: Sequence[bytes]) -> list[np.ndarray]:
    """Enrolment needs several distinct angles or the template overfits one pose."""
    out = []
    for f in frames:
        out.append(analyse(decode_image(f)).embedding)
    return out
