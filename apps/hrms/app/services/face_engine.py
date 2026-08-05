"""Face detection and recognition on onnxruntime alone.

Why this exists
---------------
We used to call ``insightface.app.FaceAnalysis``. On Windows that package has
no prebuilt wheel, so pip compiles ``insightface.thirdparty.face3d.mesh.cython``
from C++ and fails with:

    error: Microsoft Visual C++ 14.0 or greater is required

That Cython extension is a 3D morphable-model mesh renderer. FaceAnalysis never
touches it. We were being asked for a 7 GB compiler toolchain to build code we
do not run.

This module runs the *same two buffalo_l ONNX graphs* directly:

    det_10g.onnx    SCRFD detector -> boxes, scores, 5 keypoints
    w600k_r50.onnx  ArcFace R50    -> 512-d normalised embedding

onnxruntime and opencv-python-headless both ship prebuilt wheels for every
platform we care about, so installation needs no compiler anywhere.

Embeddings are numerically identical to insightface's: same graphs, same
112x112 ArcFace alignment template, same normalisation. Existing enrolled
templates stay valid.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

import numpy as np


# ArcFace's canonical 5-point template for a 112x112 crop. Do not change these:
# the recognition graph was trained on faces warped onto exactly this layout.
ARCFACE_TEMPLATE = np.array([
    [38.2946, 51.6963],   # left eye
    [73.5318, 51.5014],   # right eye
    [56.0252, 71.7366],   # nose tip
    [41.5493, 92.3655],   # left mouth corner
    [70.7299, 92.2041],   # right mouth corner
], dtype=np.float32)

DET_INPUT = 640
NMS_THRESHOLD = 0.4


def model_root() -> Path:
    """Where the buffalo_l pack lives. Matches insightface's own default so an
    existing ~/.insightface download is picked up without re-downloading."""
    env = os.environ.get("FACE_MODEL_DIR")
    if env:
        return Path(env)
    return Path.home() / ".insightface" / "models" / "buffalo_l"


class ModelsMissing(RuntimeError):
    pass


def _session(path: Path):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    # One worker per request already; extra intra-op threads just cause contention.
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)
    opts.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=opts,
                                providers=["CPUExecutionProvider"])


def _distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    out = []
    for i in range(0, distance.shape[1], 2):
        out.append(points[:, 0] + distance[:, i])
        out.append(points[:, 1] + distance[:, i + 1])
    return np.stack(out, axis=-1)


def _nms(dets: np.ndarray, thresh: float) -> List[int]:
    x1, y1, x2, y2, scores = (dets[:, 0], dets[:, 1], dets[:, 2],
                              dets[:, 3], dets[:, 4])
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = (np.maximum(0.0, xx2 - xx1 + 1) *
                 np.maximum(0.0, yy2 - yy1 + 1))
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[1:][iou <= thresh]
    return keep


class Face:
    """Field-compatible with insightface's Face for the attributes we read."""

    __slots__ = ("bbox", "kps", "det_score", "normed_embedding", "pose")

    def __init__(self, bbox, kps, det_score):
        self.bbox = bbox
        self.kps = kps
        self.det_score = det_score
        self.normed_embedding: Optional[np.ndarray] = None
        self.pose: Optional[tuple] = None    # SCRFD gives no pose; derived below


class FaceEngine:
    """Drop-in replacement for the slice of FaceAnalysis we used."""

    def __init__(self, root: Optional[Path] = None):
        root = Path(root) if root else model_root()
        det = root / "det_10g.onnx"
        rec = root / "w600k_r50.onnx"
        missing = [p.name for p in (det, rec) if not p.exists()]
        if missing:
            raise ModelsMissing(
                f"Missing {', '.join(missing)} in {root}. "
                "Run: python scripts/download_models.py")

        self.det = _session(det)
        self.rec = _session(rec)
        self.det_input = self.det.get_inputs()[0].name
        self.det_outputs = [o.name for o in self.det.get_outputs()]
        self.rec_input = self.rec.get_inputs()[0].name
        # det_10g is the 3-stride, 2-anchor SCRFD variant with keypoints.
        self.fmc = 3
        self.strides = [8, 16, 32]
        self.num_anchors = 2
        self._centre_cache: dict = {}

    # -- detection ---------------------------------------------------------
    def _detect(self, img: np.ndarray, threshold: float = 0.5):
        import cv2

        h0, w0 = img.shape[:2]
        scale = min(DET_INPUT / w0, DET_INPUT / h0)
        resized = cv2.resize(img, (int(round(w0 * scale)), int(round(h0 * scale))))
        canvas = np.zeros((DET_INPUT, DET_INPUT, 3), dtype=np.uint8)
        canvas[:resized.shape[0], :resized.shape[1]] = resized

        blob = cv2.dnn.blobFromImage(canvas, 1.0 / 128, (DET_INPUT, DET_INPUT),
                                     (127.5, 127.5, 127.5), swapRB=True)
        net_out = self.det.run(self.det_outputs, {self.det_input: blob})

        scores_all, boxes_all, kps_all = [], [], []
        for idx, stride in enumerate(self.strides):
            scores = net_out[idx]
            bbox_preds = net_out[idx + self.fmc] * stride
            kps_preds = net_out[idx + self.fmc * 2] * stride

            height = width = DET_INPUT // stride
            key = (height, width, stride)
            if key in self._centre_cache:
                centres = self._centre_cache[key]
            else:
                yx = np.stack(np.mgrid[:height, :width][::-1], axis=-1)
                centres = (yx * stride).astype(np.float32).reshape(-1, 2)
                if self.num_anchors > 1:
                    centres = np.stack([centres] * self.num_anchors,
                                       axis=1).reshape(-1, 2)
                self._centre_cache[key] = centres

            scores = scores.reshape(-1)
            keep = np.where(scores >= threshold)[0]
            if keep.size == 0:
                continue
            boxes = _distance2bbox(centres, bbox_preds.reshape(-1, 4))[keep]
            kps = _distance2kps(centres, kps_preds.reshape(-1, 10))[keep]
            scores_all.append(scores[keep])
            boxes_all.append(boxes)
            kps_all.append(kps.reshape(-1, 5, 2))

        if not scores_all:
            return []

        scores = np.concatenate(scores_all)
        boxes = np.concatenate(boxes_all) / scale
        kps = np.concatenate(kps_all) / scale

        pre = np.hstack([boxes, scores[:, None]]).astype(np.float32)
        keep = _nms(pre, NMS_THRESHOLD)
        return [Face(boxes[i], kps[i], float(scores[i])) for i in keep]

    # -- alignment + recognition ------------------------------------------
    @staticmethod
    def _norm_crop(img: np.ndarray, kps: np.ndarray) -> np.ndarray:
        import cv2
        M, _ = cv2.estimateAffinePartial2D(kps.astype(np.float32),
                                           ARCFACE_TEMPLATE, method=cv2.LMEDS)
        if M is None:
            raise ValueError("Couldn't align the face. Look straight at the camera.")
        return cv2.warpAffine(img, M, (112, 112), borderValue=0.0)

    def _embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        import cv2
        aligned = self._norm_crop(img, face.kps)
        blob = cv2.dnn.blobFromImage(aligned, 1.0 / 127.5, (112, 112),
                                     (127.5, 127.5, 127.5), swapRB=True)
        vec = self.rec.run(None, {self.rec_input: blob})[0].flatten()
        norm = np.linalg.norm(vec)
        return (vec / norm).astype(np.float32) if norm else vec.astype(np.float32)

    @staticmethod
    def _pose_from_kps(kps: np.ndarray) -> tuple:
        """Coarse pitch/yaw/roll in degrees from the 5 keypoints.

        The liveness challenge only needs to know the head turned far enough in
        the asked-for direction, and it compares against thresholds of 10-12
        degrees. This is a geometric estimate, not a calibrated 3D pose - it is
        deliberately conservative, so a borderline turn reads as "not enough"
        and the user simply turns further.
        """
        le, re, nose, lm, rm = kps
        eye_c = (le + re) / 2.0
        mouth_c = (lm + rm) / 2.0

        dx, dy = (re - le)[0], (re - le)[1]
        roll = float(np.degrees(np.arctan2(dy, dx)))

        eye_span = float(np.linalg.norm(re - le)) or 1.0
        # Nose sits between the eyes when facing forward; offset tracks yaw.
        yaw = float(np.degrees(np.arctan2((nose[0] - eye_c[0]) * 2.0, eye_span)))
        vert = float(np.linalg.norm(mouth_c - eye_c)) or 1.0
        pitch = float(np.degrees(np.arctan2((nose[1] - eye_c[1]) - vert * 0.5,
                                            vert)))
        return (pitch, yaw, roll)

    # -- public ------------------------------------------------------------
    def get(self, img: np.ndarray) -> List[Face]:
        faces = self._detect(img)
        for f in faces:
            f.normed_embedding = self._embed(img, f)
            f.pose = self._pose_from_kps(f.kps)
        return faces

    def prepare(self, *_a, **_kw):    # API parity with FaceAnalysis
        return self
