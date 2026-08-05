"""Diagnose face check-in setup. Run it with the SAME python that runs the API.

    python scripts/check_face_setup.py

Prints which interpreter it is using, whether each package imports, whether the
models are present, and - if something is missing - the exact command to fix it
using this interpreter.

The usual Windows failure is installing into a different Python than the one
serving the app: `pip` on PATH and the `python` you launch the API with are
often not the same installation. This script makes that visible instead of
leaving you to guess.
"""
import importlib.util
import os
import sys
from pathlib import Path

PACKAGES = [("cv2", "opencv-python-headless"), ("onnxruntime", "onnxruntime"),
            ("numpy", "numpy")]
MODELS = ("det_10g.onnx", "w600k_r50.onnx")


def main() -> int:
    py = f'"{sys.executable}"'
    print("Face check-in setup\n" + "=" * 60)
    print(f"Interpreter : {sys.executable}")
    print(f"Version     : {sys.version.split()[0]}")
    print(f"Working dir : {os.getcwd()}\n")

    missing = []
    for mod, dist in PACKAGES:
        spec = importlib.util.find_spec(mod)
        if spec is None:
            print(f"  [MISSING] {dist}")
            missing.append(dist)
            continue
        try:
            m = __import__(mod)
            ver = getattr(m, "__version__", "?")
            print(f"  [ok]      {dist} {ver}")
        except Exception as e:                                # noqa: BLE001
            print(f"  [BROKEN]  {dist} - imports but fails: {e}")
            missing.append(dist)

    if missing:
        print("\nInstall them into THIS interpreter:\n")
        print(f"    {py} -m pip install -r requirements-face.txt\n")
        print("A bare 'pip' may belong to a different Python installation.")
        return 1

    root = Path(os.environ.get("FACE_MODEL_DIR",
                               Path.home() / ".insightface" / "models" / "buffalo_l"))
    print(f"\nModel directory: {root}")
    absent = []
    for n in MODELS:
        p = root / n
        if p.exists():
            print(f"  [ok]      {n} ({p.stat().st_size >> 20} MB)")
        else:
            print(f"  [MISSING] {n}")
            absent.append(n)

    if absent:
        print(f"\n    {py} scripts/download_models.py\n")
        print("About 275 MB, one time.")
        return 1

    print("\nLoading the engine...")
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from app.services.face_engine import FaceEngine
        FaceEngine()
    except Exception as e:                                    # noqa: BLE001
        print(f"  [FAILED] {type(e).__name__}: {e}")
        return 1

    print("  [ok] engine loaded\n")
    print("Face check-in is ready. Restart the API if it was already running.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
