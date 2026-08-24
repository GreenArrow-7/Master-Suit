#!/usr/bin/env python3
"""Tests for the face service's shared-secret gate and its rotation rules.

Run it directly — `python3 apps/face/test_tokens.py`. No pytest, no fixtures,
nothing to install: this is what lets CI run it as one line on a runner that has
Python and nothing else, next to a service whose real dependencies are FastAPI
and half a gigabyte of ONNX graphs.

What it is for: this gate is the only thing standing between the network and a
biometric engine that turns camera frames into face vectors. It has already been
wrong twice — once accepting every request when the variable was unset, once
comparing with `!=` and leaking the token a byte at a time through timing. The
rotation support added a third way to be wrong (short-circuiting on the first
match), so the comparison is checked here rather than trusted.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tokens import accepts, refusal  # noqa: E402

FAILURES: list[str] = []


def check(label: str, condition: bool) -> None:
    print(("  ok    " if condition else "  FAIL  ") + label)
    if not condition:
        FAILURES.append(label)


print("during a rotation, both tokens are accepted")
check("the new token passes", accepts("Bearer new", "new", "old"))
check("the retired token still passes", accepts("Bearer old", "new", "old"))
check("a third token does not", not accepts("Bearer other", "new", "old"))

print("once the rotation is finished, the retired token is dead")
check("the new token passes", accepts("Bearer new", "new", ""))
check("the retired token is refused", not accepts("Bearer old", "new", ""))

print("nothing else gets in")
check("an empty header is refused", not accepts("", "new", "old"))
check("the token without the Bearer prefix is refused", not accepts("new", "new", "old"))
check("a prefix of the token is refused", not accepts("Bearer ne", "new", "old"))
check("the token with a suffix is refused", not accepts("Bearer newX", "new", "old"))
check("a lowercase scheme is refused", not accepts("bearer new", "new", "old"))
# A header carrying non-ASCII used to raise TypeError out of compare_digest and
# surface as a 500 — an authentication failure reported as a server fault.
check("a non-ASCII header is refused, not raised", not accepts("Bearer éé", "new", "old"))

print("no token configured means no gate — development only, and main.py refuses to start that way elsewhere")
check("anything passes", accepts("", "", ""))

print("configurations that must not start")
check("no token outside development", "FACE_SERVICE_TOKEN is unset" in refusal("", "", "production"))
check("no token in development is fine", refusal("", "", "development") == "")
check("a previous token with no current token", "needs a token to rotate" in refusal("", "old", "production"))
check("a previous token equal to the current one", "not a rotation" in refusal("same", "same", "production"))
check("a real rotation is allowed to start", refusal("new", "old", "production") == "")
check("a finished rotation is allowed to start", refusal("new", "", "production") == "")

if FAILURES:
    print(f"\n{len(FAILURES)} failed:")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)

print("\nface token gate: all checks passed.")
