"""The shared-secret gate, and the rules for rotating it.

Separate from main.py for one reason: main.py imports FastAPI and, through
face_engine, onnxruntime and several hundred megabytes of ONNX graphs. Nothing
here needs any of that, and a test that has to load the models to check a string
comparison is a test nobody runs. This module imports `hmac` and stops.

── Why there are two tokens ─────────────────────────────────────────────────

The application sends a bearer token and this service checks it. When both sides
read a single value, rotating it means a window in which the application is
sending the old token and the service only accepts the new one — every check-in
is a 401 and nobody can start their shift. The honest consequence of that is
that the secret never gets rotated; the assessment records it as M-7.

Accepting the outgoing token for the length of the rotation removes the window:

  1. face:  FACE_SERVICE_TOKEN=<new>   FACE_SERVICE_TOKEN_PREVIOUS=<old>
  2. web:   FACE_SERVICE_TOKEN=<new>
  3. face:  unset FACE_SERVICE_TOKEN_PREVIOUS

At no point is there a token in flight that is not accepted. Step 3 is not
optional: a previous token left set is a second live credential nobody is
watching, which is most of what the rotation was for. `scripts/rotate-face-token.sh`
walks the three steps, and the FaceServiceTokenStale alert is what notices when
a deployment stops doing them.
"""

from __future__ import annotations

import hmac


def accepts(authorization: str, token: str, previous: str = "") -> bool:
    """Whether an Authorization header may pass, compared in constant time.

    `!=` on a string returns as soon as two bytes differ, so the time it takes to
    refuse tells the caller how much of the prefix was right — enough, over many
    requests, to recover the token a byte at a time. `compare_digest` takes the
    same time whatever the input.

    Both candidates are always compared and the results combined afterwards. A
    short-circuit on the first match would make a request accepted by the current
    token measurably faster than one accepted by the previous token, which tells
    an attacker which credential they hold and gives back the property the
    constant-time comparison exists to provide.

    An empty `token` means no gate at all. main.py refuses to start in that state
    anywhere but development, so it is reachable only on a laptop.
    """
    if not token:
        return True

    # compare_digest requires bytes-like or ASCII-only str; a header carrying
    # non-ASCII would otherwise raise TypeError and surface as a 500 rather than
    # the 401 it is.
    supplied = authorization.encode("utf-8", "replace")

    accepted = hmac.compare_digest(supplied, f"Bearer {token}".encode("utf-8"))
    if previous:
        # `|` rather than `or`: `or` short-circuits, which is the early return
        # this function exists to avoid.
        accepted |= hmac.compare_digest(supplied, f"Bearer {previous}".encode("utf-8"))
    return accepted


def refusal(token: str, previous: str, environment: str) -> str:
    """The reason this configuration must not start, or "" if it may.

    Returned rather than raised so main.py owns the exit and the tests do not
    have to catch SystemExit to read the message.
    """
    # The rotation-consistency checks come first, and are not conditioned on the
    # environment: a half-configured rotation is incoherent on a laptop too, and
    # putting the unset-token check ahead of them made this branch unreachable
    # outside development while answering "FACE_SERVICE_TOKEN is unset" — true,
    # but not the thing that is wrong.
    if previous and not token:
        return (
            "FACE_SERVICE_TOKEN_PREVIOUS is set but FACE_SERVICE_TOKEN is not.\n"
            "       A rotation needs a token to rotate *to*."
        )

    if previous and hmac.compare_digest(previous.encode("utf-8"), token.encode("utf-8")):
        # A "rotation" to the same value. Nothing was rotated, and leaving the
        # variable set makes step 3 look done when it is not.
        return (
            "FACE_SERVICE_TOKEN_PREVIOUS equals FACE_SERVICE_TOKEN.\n"
            "       That is not a rotation. Set PREVIOUS to the token being retired,\n"
            "       or unset it once the rotation is complete."
        )

    if not token and environment != "development":
        # An unauthenticated biometric engine is not a degraded mode, it is an
        # open one: anything that can reach the port submits frames and receives
        # face embeddings. This used to be a silent pass-through, so a deployment
        # that forgot the variable looked identical to one that set it.
        return (
            f"FACE_SERVICE_TOKEN is unset and FACE_SERVICE_ENV is {environment!r}.\n"
            "       This service turns camera frames into biometric vectors; it must not\n"
            "       accept unauthenticated requests outside local development. Set a long\n"
            "       random FACE_SERVICE_TOKEN, matching the web application's."
        )

    return ""
