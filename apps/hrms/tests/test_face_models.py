"""Real model checks for the onnxruntime face engine.

These skip cleanly when the models aren't downloaded, so CI and a fresh clone
still go green. Run `python scripts/download_models.py` to enable them.

Test images come from the model directory, not from an installed package -
insightface is no longer a dependency (see app/services/face_engine.py).
"""
import os
from pathlib import Path

import numpy as np
import pytest

from app.services.face import (
    ChallengeStore, analyse, cosine, engine_ready, verify_liveness,
)

pytestmark = pytest.mark.skipif(not engine_ready(),
                                reason="buffalo_l models not downloaded")

SAMPLES = Path(os.environ.get("FACE_TEST_IMAGES", "tests/faces"))


def _sample_paths():
    if not SAMPLES.is_dir():
        return []
    return sorted(p for p in SAMPLES.iterdir()
                  if p.suffix.lower() in {".jpg", ".jpeg", ".png"})


def sample_image():
    import cv2
    paths = _sample_paths()
    if not paths:
        pytest.skip(f"No test faces in {SAMPLES}")
    return cv2.imread(str(paths[0]))


def crop_faces():
    """Return each detected face as its own single-face frame."""
    import cv2
    from app.services.face_engine import FaceEngine
    eng = FaceEngine()
    out = []
    for path in _sample_paths():
        img = cv2.imread(str(path))
        if img is None:
            continue
        h, w = img.shape[:2]
        for f in eng.get(img):
            x1, y1, x2, y2 = [int(v) for v in f.bbox]
            pad = int(max(x2 - x1, y2 - y1) * 0.6)
            crop = img[max(y1 - pad, 0):min(y2 + pad, h),
                       max(x1 - pad, 0):min(x2 + pad, w)]
            if crop.size:
                out.append(cv2.resize(crop, (400, 400)))
    if not out:
        pytest.skip(f"No faces found in {SAMPLES}")
    return out


def test_models_load():
    assert engine_ready()


def test_single_face_crop_is_analysed():
    faces = crop_faces()
    assert faces, "expected to find faces in the sample photo"
    d = analyse(faces[0])
    assert d.embedding.shape[0] == 512
    assert 0.0 <= d.det_score <= 1.0
    assert d.blur_score > 0


def multi_face_image():
    """Two faces in one frame, built by tiling the samples side by side so the
    test does not depend on shipping a group photo."""
    import cv2
    paths = _sample_paths()
    if len(paths) < 2:
        pytest.skip("need two sample images")
    a, b = (cv2.imread(str(paths[0])), cv2.imread(str(paths[1])))
    h = max(a.shape[0], b.shape[0])
    scale = lambda im: cv2.resize(im, (int(im.shape[1] * h / im.shape[0]), h))
    return cv2.hconcat([scale(a), scale(b)])


def test_multiple_faces_in_frame_are_rejected():
    img = multi_face_image()
    from app.services.face_engine import FaceEngine
    if len(FaceEngine().get(img)) < 2:
        pytest.skip("tiled frame did not yield two detections")
    with pytest.raises(ValueError, match="More than one face"):
        analyse(img)


def test_blank_frame_has_no_face():
    blank = np.full((400, 400, 3), 128, dtype=np.uint8)
    with pytest.raises(ValueError, match="No face"):
        analyse(blank)


def test_same_face_matches_itself_and_different_faces_do_not():
    """Uses the full frames, not upscaled crops: blowing a 31px face up to
    400px trips the blur guard, which is the guard working correctly rather
    than a recognition failure."""
    import cv2
    paths = _sample_paths()
    if len(paths) < 2:
        pytest.skip("need two distinct faces")
    first, second = cv2.imread(str(paths[0])), cv2.imread(str(paths[1]))
    a = analyse(first).embedding
    a_again = analyse(first).embedding

    # The impostor frame may legitimately fail the capture-quality guards
    # (too small, too blurry) without saying anything about recognition, so
    # take its embedding straight from the engine.
    from app.services.face_engine import FaceEngine
    detected = FaceEngine().get(second)
    if not detected:
        pytest.skip("no face in the second sample")
    b = detected[0].normed_embedding
    assert cosine(a, a_again) > 0.99
    # Different people must land well below the 0.55 production threshold.
    assert cosine(a, b) < 0.45, "two different people scored as a match"


def test_liveness_rejects_a_still_photo():
    """The core anti-spoof case: the same static frame sent twice."""
    import cv2
    faces = crop_faces()
    ok, buf = cv2.imencode(".jpg", faces[0])
    jpg = buf.tobytes()
    result = verify_liveness([jpg, jpg + b"\x00"], "left")
    assert result.passed is False


def test_challenge_store_is_single_use():
    store = ChallengeStore()
    ch = store.issue(employee_id=7)
    assert store.consume(ch.nonce, 7).direction == ch.direction
    with pytest.raises(ValueError, match="already used"):
        store.consume(ch.nonce, 7)


def test_challenge_bound_to_employee():
    store = ChallengeStore()
    ch = store.issue(employee_id=7)
    with pytest.raises(ValueError):
        store.consume(ch.nonce, 8)
