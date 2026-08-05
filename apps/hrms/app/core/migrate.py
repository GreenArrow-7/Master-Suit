"""Lightweight schema reconciliation.

SQLAlchemy's create_all() creates missing tables but never alters existing ones.
So upgrading the code against a database seeded by an older version leaves the
new columns missing, and every query touching that table fails with a 500 —
"no such column: employees.totp_secret_encrypted".

This module closes that gap for the additive changes this project makes:
new tables, and new nullable (or defaulted) columns. It is deliberately NOT a
migration framework. It will not drop columns, rename them, change types, or
backfill data. If you need any of that, add Alembic — this is here so a small
deployment can pull an update without hand-editing SQLite.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateTable

from app.core.db import Base

log = logging.getLogger("manath.migrate")


def _column_sql(dialect_name: str, column) -> str | None:
    """DDL fragment for ADD COLUMN, or None if it can't be added safely.

    A NOT NULL column can only be added to a populated table if it has a
    default — otherwise existing rows would violate it immediately.
    """
    type_sql = column.type.compile(dialect=_dialect(dialect_name))
    parts = [f'"{column.name}"', type_sql]

    default = None
    if column.server_default is not None:
        default = str(column.server_default.arg)
    elif column.default is not None and not column.default.is_callable:
        value = column.default.arg
        if isinstance(value, bool):
            default = "1" if value else "0"
        elif isinstance(value, (int, float)):
            default = str(value)
        elif isinstance(value, str):
            default = f"'{value}'"

    if not column.nullable:
        if default is None:
            return None          # can't add this safely; caller warns
        parts.append("NOT NULL")

    if default is not None:
        parts.append(f"DEFAULT {default}")

    return " ".join(parts)


def _dialect(name: str):
    if name == "sqlite":
        from sqlalchemy.dialects.sqlite import dialect
    elif name.startswith("postgres"):
        from sqlalchemy.dialects.postgresql import dialect
    else:
        from sqlalchemy.dialects.sqlite import dialect
    return dialect()


def reconcile_schema(engine: Engine) -> dict:
    """Adds missing tables and columns. Returns what it changed."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added_tables: list[str] = []
    added_columns: list[str] = []
    skipped: list[str] = []

    # 1. New tables first — a new column may reference one.
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            with engine.begin() as conn:
                conn.execute(CreateTable(table))
            added_tables.append(table.name)

    # 2. New columns on tables that already existed.
    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if table.name in added_tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in have:
                continue
            ddl = _column_sql(engine.dialect.name, column)
            if ddl is None:
                skipped.append(f"{table.name}.{column.name}")
                continue
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN {ddl}'))
            added_columns.append(f"{table.name}.{column.name}")

    if added_tables:
        log.info("Schema: added tables %s", ", ".join(added_tables))
    if added_columns:
        log.info("Schema: added columns %s", ", ".join(added_columns))
    if skipped:
        log.warning(
            "Schema: could not add %s automatically (NOT NULL with no default). "
            "Add them by hand, or delete the database and re-seed.",
            ", ".join(skipped))

    return {"tables_added": added_tables, "columns_added": added_columns,
            "skipped": skipped}
