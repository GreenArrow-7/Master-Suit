"""Downloads the buffalo_l ONNX model pack (~275 MB) once.

No compiler and no insightface package required - this just fetches a zip and
unpacks the two .onnx graphs we run through onnxruntime.

    python scripts/download_models.py

Files land in ~/.insightface/models/buffalo_l (override with FACE_MODEL_DIR).
That is the same path insightface used, so an existing download is reused.
"""
import hashlib
import os
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

URL = ("https://github.com/deepinsight/insightface/releases/download/"
       "v0.7/buffalo_l.zip")
# A release tag does not pin a file: an asset can be deleted and re-uploaded
# under the same name. Anything but this exact archive (288,621,354 bytes) is
# refused before it is unpacked, and a truncated body fails the same check.
SHA256 = "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f"
NEEDED = ("det_10g.onnx", "w600k_r50.onnx")
ATTEMPTS = 4


def fetch(zip_path: Path) -> str:
    """Streams URL into zip_path and returns the SHA-256 of what arrived."""
    digest = hashlib.sha256()
    # urlopen raises on an HTTP error status and follows the redirect GitHub
    # answers release downloads with.
    with urllib.request.urlopen(URL, timeout=60) as r:
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(zip_path, "wb") as fh:
            while chunk := r.read(1 << 20):
                fh.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    print(f"\r  {pct:3d}%  {done >> 20} / {total >> 20} MB",
                          end="", flush=True)
        print()
    return digest.hexdigest()


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

    zip_path = dest / "buffalo_l.zip"
    print(f"Downloading buffalo_l (~275 MB) to {dest} ...")
    for attempt in range(1, ATTEMPTS + 1):
        try:
            got = fetch(zip_path)
            if got == SHA256:
                break
            problem = f"SHA-256 {got} is not the pinned {SHA256}"
        except Exception as e:                               # noqa: BLE001
            problem = str(e)
        zip_path.unlink(missing_ok=True)
        print(f"\nAttempt {attempt}/{ATTEMPTS} failed: {problem}",
              file=sys.stderr)
        if attempt == ATTEMPTS:
            print(f"\nIf this machine is behind a proxy, fetch {URL} manually,\n"
                  f"check its SHA-256 is {SHA256}\n"
                  f"and unzip it into {dest}", file=sys.stderr)
            return 1
        time.sleep(5 * attempt)

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
