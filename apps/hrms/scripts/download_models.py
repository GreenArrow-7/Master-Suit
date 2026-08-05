"""Downloads the buffalo_l ONNX model pack (~275 MB) once.

No compiler and no insightface package required - this just fetches a zip and
unpacks the two .onnx graphs we run through onnxruntime.

    python scripts/download_models.py

Files land in ~/.insightface/models/buffalo_l (override with FACE_MODEL_DIR).
That is the same path insightface used, so an existing download is reused.
"""
import os
import sys
import zipfile
from pathlib import Path

URL = ("https://github.com/deepinsight/insightface/releases/download/"
       "v0.7/buffalo_l.zip")
NEEDED = ("det_10g.onnx", "w600k_r50.onnx")


def target_dir() -> Path:
    env = os.environ.get("FACE_MODEL_DIR")
    if env:
        return Path(env)
    return Path.home() / ".insightface" / "models" / "buffalo_l"


def main() -> int:
    dest = target_dir()
    dest.mkdir(parents=True, exist_ok=True)

    if all((dest / n).exists() for n in NEEDED):
        print(f"Models already present in {dest}. Nothing to do.")
        return 0

    try:
        import requests
    except ImportError:
        print("Install the face extras first:\n"
              "    pip install -r requirements-face.txt", file=sys.stderr)
        return 1

    zip_path = dest / "buffalo_l.zip"
    print(f"Downloading buffalo_l (~275 MB) to {dest} ...")
    try:
        with requests.get(URL, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            done = 0
            with open(zip_path, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        pct = done * 100 // total
                        print(f"\r  {pct:3d}%  {done >> 20} / {total >> 20} MB",
                              end="", flush=True)
            print()
    except Exception as e:                                   # noqa: BLE001
        print(f"\nDownload failed: {e}\n\n"
              f"If this machine is behind a proxy, fetch {URL} manually and\n"
              f"unzip it into {dest}", file=sys.stderr)
        return 1

    print("Unpacking ...")
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            name = Path(member).name
            if name in NEEDED:
                with z.open(member) as src, open(dest / name, "wb") as out:
                    out.write(src.read())
    zip_path.unlink(missing_ok=True)

    missing = [n for n in NEEDED if not (dest / n).exists()]
    if missing:
        print(f"Archive did not contain: {', '.join(missing)}", file=sys.stderr)
        return 1

    for n in NEEDED:
        size = (dest / n).stat().st_size >> 20
        print(f"  {n}  {size} MB")
    print("\nDone. Restart the API and face check-in will be available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
