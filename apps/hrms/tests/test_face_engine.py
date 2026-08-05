"""The onnxruntime engine that replaced insightface.

insightface was dropped because pip had to compile its face3d Cython
extension from C++ - a 3D mesh renderer this app never calls - which failed
on Windows with "Microsoft Visual C++ 14.0 or greater is required".

These tests prove the replacement is not just importable but correct: it
finds faces, places keypoints anatomically, and produces embeddings that
actually discriminate identity.
"""
import os
from pathlib import Path

import numpy as np
import pytest

from app.services.face import engine_ready

pytestmark = pytest.mark.skipif(not engine_ready(),
                                reason="buffalo_l models not downloaded")

# Face fixtures are supplied locally and are never committed: a photograph of an
# identifiable person is personal data, and Git keeps it forever. Point
# FACE_TEST_IMAGES at a directory of images you are entitled to use, or these
# tests skip. See docs/TEST-DATA-POLICY.md.
FACES = Path(os.environ.get("FACE_TEST_IMAGES", "tests/faces-local"))


@pytest.fixture(scope="module")
def engine():
    from app.services.face_engine import FaceEngine
    return FaceEngine()


def _fixtures():
    """Every usable image in the local fixture directory, sorted for stability."""
    if not FACES.is_dir():
        return []
    return sorted(p for p in FACES.iterdir()
                  if p.suffix.lower() in {".jpg", ".jpeg", ".png"})


def _read(index=0):
    """One face fixture by position.

    Deliberately positional rather than by filename: the fixtures are supplied
    locally by whoever runs the suite, so the tests cannot assume any particular
    person's image is present.
    """
    import cv2
    paths = _fixtures()
    if len(paths) <= index:
        pytest.skip(f"Fewer than {index + 1} face fixtures in {FACES}. Set "
                    "FACE_TEST_IMAGES to a directory of images you are entitled "
                    "to use (see docs/TEST-DATA-POLICY.md).")
    image = cv2.imread(str(paths[index]))
    if image is None:
        pytest.skip(f"Could not read the face fixture at {paths[index]}.")
    return image


def test_detects_a_single_face(engine):
    faces = engine.get(_read())
    assert len(faces) == 1
    assert faces[0].det_score > 0.6


def test_no_false_positives_on_noise(engine):
    rng = np.random.default_rng(0)
    noise = (rng.random((480, 640, 3)) * 255).astype(np.uint8)
    assert engine.get(noise) == []


def test_keypoints_are_anatomically_ordered(engine):
    f = engine.get(_read())[0]
    le, re, nose, lm, rm = f.kps
    assert le[0] < re[0]                  # left eye left of right eye
    assert nose[1] > min(le[1], re[1])    # nose below the eyes
    assert lm[1] > nose[1] and rm[1] > nose[1]   # mouth below the nose
    x1, y1, x2, y2 = f.bbox
    for kp in f.kps:                      # every keypoint inside the box
        assert x1 <= kp[0] <= x2 and y1 <= kp[1] <= y2


def test_embedding_is_512d_and_unit_norm(engine):
    emb = engine.get(_read())[0].normed_embedding
    assert emb.shape == (512,)
    assert np.isclose(np.linalg.norm(emb), 1.0, atol=1e-4)


def test_same_face_survives_rescaling_and_lighting(engine):
    import cv2
    from app.services.face import SAME_PERSON_THRESHOLD
    img = _read()
    base = engine.get(img)[0].normed_embedding
    variants = {
        "rescaled": cv2.resize(img, (320, 320)),
        "darker": cv2.convertScaleAbs(img, alpha=0.65, beta=10),
        "blurred": cv2.GaussianBlur(img, (5, 5), 0),
    }
    for label, v in variants.items():
        got = engine.get(v)
        assert got, f"{label}: face lost"
        sim = float(np.dot(base, got[0].normed_embedding))
        assert sim > 0.7, f"{label}: similarity {sim:.3f} too low"
        assert sim > SAME_PERSON_THRESHOLD


def test_different_people_are_far_apart(engine):
    """Needs two fixtures of *different* people; skips when only one is supplied.

    This is the test that proves the embedding discriminates identity at all, so
    a single-fixture setup silently skipping it is worth knowing about.
    """
    from app.services.face import SAME_PERSON_THRESHOLD
    a = engine.get(_read(0))[0].normed_embedding
    b = engine.get(_read(1))[0].normed_embedding
    sim = float(np.dot(a, b))
    assert sim < 0.3, f"impostor similarity {sim:.3f} is dangerously high"
    assert sim < SAME_PERSON_THRESHOLD


def test_missing_models_raise_a_clear_error(tmp_path):
    from app.services.face_engine import FaceEngine, ModelsMissing
    with pytest.raises(ModelsMissing) as e:
        FaceEngine(root=tmp_path)
    assert "download_models" in str(e.value)
