import secrets
import warnings

from pydantic_settings import BaseSettings

INSECURE_SECRET = "CHANGE-ME-IN-PROD"


class Settings(BaseSettings):
    APP_NAME: str = "Manath Homes HRMS"
    COMPANY_NAME: str = "Manath Homes"
    ENVIRONMENT: str = "development"          # development | production
    DATABASE_URL: str = "sqlite:///./manath_homes.db"

    JWT_SECRET: str = INSECURE_SECRET
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14

    CORS_ORIGINS: str = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000"

    # Face matching. 0.55 is a starting point for buffalo_l normed embeddings.
    # Tune against your own staff, lighting and phones before going live.
    ATTENDANCE_PHOTO_DIR: str = "storage/attendance"
    ATTENDANCE_PHOTO_RETENTION_DAYS: int = 180
    FACE_MATCH_THRESHOLD: float = 0.55
    FACE_SAMPLES_REQUIRED: int = 4
    FACE_ENROLMENT_MIN_SPREAD: float = 0.02   # samples must differ, or it's one pose x4

    # Geofence
    GEOFENCE_DEFAULT_RADIUS_M: int = 150
    MAX_GPS_ACCURACY_M: int = 100

    # Punch sanity
    MIN_PUNCH_INTERVAL_SECONDS: int = 60
    MAX_OFFLINE_SYNC_HOURS: int = 48

    # Documents
    DOCUMENT_STORAGE_DIR: str = "./storage/documents"
    MAX_DOCUMENT_BYTES: int = 10485760

    # Only these email domains may hold an account. Comma-separated for the case
    # where a group runs more than one domain. Empty means no restriction, which
    # you should not do in production.
    ALLOWED_EMAIL_DOMAINS: str = "manathhomes.ae"

    # Two-factor authentication
    TOTP_ENCRYPTION_KEY: str = ""          # blank = derive from JWT_SECRET
    TOTP_REQUIRED_ROLES: str = "hr,admin"  # these roles must enrol before use
    MFA_TOKEN_MINUTES: int = 5             # life of the half-authenticated token

    TIMEZONE: str = "Asia/Dubai"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def allowed_domains(self) -> list[str]:
        return [d.strip().lower().lstrip("@") for d in
                self.ALLOWED_EMAIL_DOMAINS.split(",") if d.strip()]

    @property
    def totp_required_roles(self) -> set[str]:
        return {r.strip().lower() for r in self.TOTP_REQUIRED_ROLES.split(",") if r.strip()}

    def email_allowed(self, email: str) -> bool:
        domains = self.allowed_domains
        if not domains:
            return True
        return (email or "").strip().lower().rsplit("@", 1)[-1] in domains

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    def validate_runtime(self) -> None:
        """Called at startup. A default signing key in production means anyone
        who has read the source can mint an admin token."""
        if self.JWT_SECRET == INSECURE_SECRET or len(self.JWT_SECRET) < 32:
            if self.is_production:
                raise RuntimeError(
                    "JWT_SECRET is missing or too short. Set a random 64-character "
                    "value in .env before starting in production.")
            warnings.warn(
                "Using a development JWT_SECRET. Set a real one in .env before "
                f"deploying. Suggested value: {secrets.token_urlsafe(48)}",
                stacklevel=2)
        if self.is_production and self.DATABASE_URL.startswith("sqlite"):
            warnings.warn(
                "SQLite in production. Move to PostgreSQL before you pass ~50 staff.",
                stacklevel=2)


settings = Settings()
