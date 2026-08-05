"""Business rules: geofence, face matching, UAE gratuity, leave accrual.

NOTE: gratuity and leave figures follow UAE Federal Decree-Law 33/2021 as a
baseline. Verify against your MOHRE contracts and a labour advisor before
running live payouts.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Sequence

import numpy as np

EARTH_RADIUS_M = 6_371_000.0


# --------------------------------------------------------------------------
# Geofence
# --------------------------------------------------------------------------
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def inside_geofence(lat, lon, site_lat, site_lon, radius_m, gps_accuracy_m=0.0):
    """Returns (allowed, distance_m).

    GPS accuracy is subtracted so a genuinely-present employee standing at the
    edge is not rejected by sensor noise. Never trust a client-side 'inside' flag.
    """
    distance = haversine_m(lat, lon, site_lat, site_lon)
    return (distance - float(gps_accuracy_m or 0)) <= radius_m, distance


# --------------------------------------------------------------------------
# Face matching
# --------------------------------------------------------------------------
def to_bytes(vec: Sequence[float]) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def from_bytes(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def best_match(probe: Sequence[float], templates: Sequence[bytes]) -> float:
    """Highest cosine similarity against an employee's enrolled templates."""
    if not templates:
        return 0.0
    p = np.asarray(probe, dtype=np.float32)
    return max(cosine_similarity(p, from_bytes(t)) for t in templates)


# --------------------------------------------------------------------------
# UAE gratuity (end of service benefit)
# --------------------------------------------------------------------------
def service_years(joined: date, exited: date) -> float:
    return (exited - joined).days / 365.25


def gratuity_uae(basic_salary_monthly: float, joined: date, exited: date,
                 resigned: bool = False) -> dict:
    """21 days basic per year for the first 5 years, 30 days per year after.

    Under Decree-Law 33/2021 the resignation reduction that applied to the old
    unlimited-contract regime no longer applies to standard limited contracts,
    but under 1 year of service earns nothing. `resigned` is kept as an input
    because some legacy contracts still carry reduction clauses — confirm yours.
    """
    years = service_years(joined, exited)
    if years < 1:
        return {"years": round(years, 3), "days": 0.0, "amount": 0.0,
                "note": "Under one year of service — no gratuity entitlement."}

    daily = basic_salary_monthly / 30.0
    first = min(years, 5) * 21
    beyond = max(years - 5, 0) * 30
    days = first + beyond
    amount = days * daily
    # Statutory cap: total gratuity may not exceed two years' total basic pay.
    cap = basic_salary_monthly * 24
    capped = amount > cap
    return {
        "years": round(years, 3),
        "days": round(days, 2),
        "amount": round(min(amount, cap), 2),
        "capped_at_two_years": capped,
        "note": "Verify against the signed MOHRE contract before payout.",
    }


# --------------------------------------------------------------------------
# Leave accrual
# --------------------------------------------------------------------------
def annual_leave_accrued(joined: date, as_of: date) -> float:
    """UAE: 2 days/month between 6 and 12 months of service, 30 days/year after.

    Returns days accrued in the current entitlement year.
    """
    months = (as_of.year - joined.year) * 12 + (as_of.month - joined.month)
    if as_of.day < joined.day:
        months -= 1
    if months < 6:
        return 0.0
    if months < 12:
        return round(months * 2.0, 2)
    months_this_year = as_of.month
    return round(min(months_this_year * 2.5, 30.0), 2)


def working_days(start: date, end: date, holidays: Sequence[date] = (),
                 weekend=(5, 6)) -> float:
    """Counts leave days. UAE weekend defaults to Sat/Sun (weekday 5,6).

    Many UAE firms run a Fri-half/Sat weekend — override `weekend` per policy.
    """
    if end < start:
        raise ValueError("End date must be on or after the start date.")
    hol = set(holidays)
    days, cur = 0, start
    while cur <= end:
        if cur.weekday() not in weekend and cur not in hol:
            days += 1
        cur = date.fromordinal(cur.toordinal() + 1)
    return float(days)
