"""Shared test database and fixtures.

Every test module overrides the same global get_db dependency, so the engine and
the override must live here — otherwise whichever module imports last wins and
the others silently talk to a different database.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-key-at-least-32-characters-long!!")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DOCUMENT_STORAGE_DIR", "./storage/test-documents")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base, get_db
from app.main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                       poolclass=StaticPool)
TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _override():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override
client = TestClient(app)


@pytest.fixture
def db():
    s = TestSession()
    try:
        yield s
    finally:
        s.close()


def reset_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
