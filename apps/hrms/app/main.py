import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import attendance, auth, leave, lifecycle, locations, roles
from app.core.config import settings
from app.core.db import engine
from app.models import core, locations as _loc_models, rbac as _rbac_models  # noqa: F401  (registers models)

log = logging.getLogger("manath")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()
    # Schema changes are intentionally not performed by the web process. Run
    # `alembic upgrade head` as a controlled deployment job before starting it.

    # Seed the permission catalogue, the 12 default roles, and migrate anyone
    # still on the legacy single-role column to a real role assignment.
    from sqlalchemy.orm import Session as _S
    from app.services.rbac import seed_rbac
    with _S(engine) as s_:
        seed_rbac(s_)
    # An empty employee table means seed.py never completed — usually because
    # SEED_ADMIN_PASSWORD was rejected. Without this the server starts happily
    # and every login returns 401 with no clue why.
    from sqlalchemy.orm import Session
    from app.models.core import Employee
    with Session(engine) as check:
        if check.query(Employee).count() == 0:
            log.warning(
                "No accounts exist in the database — nobody can sign in.\n"
                "    Run the seed script first:\n"
                "      PowerShell:  $env:SEED_ADMIN_PASSWORD = \"AtLeast12Chars!\"\n"
                "                   .\\.venv\\Scripts\\python.exe seed.py\n"
                "      bash:        export SEED_ADMIN_PASSWORD='AtLeast12Chars!'\n"
                "                   .venv/bin/python seed.py")

    from app.services.face import engine_ready
    if engine_ready():
        log.info("Face engine ready (buffalo_l).")
    else:
        import importlib.util
        installed = importlib.util.find_spec("onnxruntime") is not None
        # There is no PIN fallback any more: without the engine, nobody can
        # record attendance at all. Log it loudly rather than as a footnote.
        from app.services.face import diagnose
        log.warning("FACE RECOGNITION UNAVAILABLE - NO ATTENDANCE CAN BE "
                    "RECORDED.\n%s", diagnose())
    yield


app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(attendance.router)
app.include_router(locations.router)
app.include_router(roles.router)
app.include_router(roles.access)
app.include_router(leave.router)
app.include_router(lifecycle.router)


@app.get("/health")
def health():
    # An empty employee table means seed.py never completed — usually because
    # SEED_ADMIN_PASSWORD was rejected. Without this the server starts happily
    # and every login returns 401 with no clue why.
    from sqlalchemy.orm import Session
    from app.models.core import Employee
    with Session(engine) as check:
        if check.query(Employee).count() == 0:
            log.warning(
                "No accounts exist in the database — nobody can sign in.\n"
                "    Run the seed script first:\n"
                "      PowerShell:  $env:SEED_ADMIN_PASSWORD = \"AtLeast12Chars!\"\n"
                "                   .\\.venv\\Scripts\\python.exe seed.py\n"
                "      bash:        export SEED_ADMIN_PASSWORD='AtLeast12Chars!'\n"
                "                   .venv/bin/python seed.py")

    from app.services.face import engine_ready
    return {"status": "ok", "app": settings.APP_NAME,
            "company": settings.COMPANY_NAME,
            "environment": settings.ENVIRONMENT,
            "face_engine": engine_ready()}


# Serve the UI from the same origin so the browser doesn't need CORS at all.
app.mount("/", StaticFiles(directory="web", html=True), name="web")
