from datetime import date
import numpy as np
from app.services.rules import (
    haversine_m, inside_geofence, gratuity_uae, annual_leave_accrued,
    working_days, best_match, to_bytes,
)

def test_haversine_known_distance():
    # Burj Khalifa -> Dubai Mall, roughly 700m
    d = haversine_m(25.1972, 55.2744, 25.1975, 55.2796)
    assert 400 < d < 700

def test_geofence_accuracy_grace():
    ok, dist = inside_geofence(25.2000, 55.2700, 25.2000, 55.2712, 100, gps_accuracy_m=40)
    assert ok is True and dist > 100

def test_geofence_rejects_far():
    ok, dist = inside_geofence(25.2000, 55.2700, 25.2500, 55.3200, 150, 10)
    assert ok is False and dist > 5000

def test_gratuity_under_one_year():
    r = gratuity_uae(10000, date(2025, 1, 1), date(2025, 9, 1))
    assert r["amount"] == 0.0

def test_gratuity_three_years():
    r = gratuity_uae(9000, date(2022, 1, 1), date(2025, 1, 1))
    assert 18000 < r["amount"] < 19500
    assert r["capped_at_two_years"] is False

def test_gratuity_capped():
    r = gratuity_uae(10000, date(1985, 1, 1), date(2025, 1, 1))
    assert r["amount"] == 240000.0 and r["capped_at_two_years"] is True

def test_leave_accrual_before_six_months():
    assert annual_leave_accrued(date(2025, 1, 1), date(2025, 4, 1)) == 0.0

def test_leave_accrual_partial_year():
    assert annual_leave_accrued(date(2025, 1, 1), date(2025, 8, 1)) == 14.0

def test_working_days_skips_weekend():
    assert working_days(date(2025, 6, 2), date(2025, 6, 8)) == 5.0

def test_working_days_rejects_reversed():
    import pytest
    with pytest.raises(ValueError):
        working_days(date(2025, 6, 8), date(2025, 6, 2))

def test_face_match_identical():
    v = np.random.rand(512).astype(np.float32)
    assert best_match(v, [to_bytes(v)]) > 0.999

def test_face_match_different():
    a = np.random.rand(512).astype(np.float32)
    b = -a
    assert best_match(a, [to_bytes(b)]) < 0.0
