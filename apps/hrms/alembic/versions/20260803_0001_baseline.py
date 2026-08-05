"""Create the controlled HRMS baseline schema."""
from alembic import op

from app.core.db import Base
from app.models import core, locations, rbac  # noqa: F401

revision = "20260803_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    # Restore a verified backup instead of dropping employee records.
    raise RuntimeError("The HRMS baseline cannot be downgraded destructively.")
