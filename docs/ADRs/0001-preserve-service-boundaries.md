# ADR 0001: Preserve service boundaries during convergence

Status: accepted.

The platform keeps the Sales/Next.js and HRMS/FastAPI processes separate while
identity, tenancy and shared services converge. This avoids a high-risk rewrite,
preserves verified domain behavior and supports incremental data migration. The
customer-facing shell and identity authority become shared; process count is an
operational detail.
