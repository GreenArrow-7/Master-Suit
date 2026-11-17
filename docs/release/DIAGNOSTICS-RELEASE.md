# Releasing the diagnostics build

Candidate **`b903edc04a81e6ba664f3fa8e6c0e3ce418e89af`**, prepared 11 November 2026. Every command is labelled. Nothing here has been executed from the
authoring session, which cannot reach either host.

## What this candidate is

The client diagnostics — the blank-screen detector, the failed-request
instrument and the Diagnostics screen — on the lead-release baseline, plus the
staging acceptance script itself.

|                          |                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Candidate                | `b903edc04a81e6ba664f3fa8e6c0e3ce418e89af`                                                                                  |
| Short tag                | `b903edc04a81`                                                                                                              |
| **Migrations vs `main`** | **0**                                                                                                                       |
| CI                       | `verify` and `face-e2e` passed at `22786b65`; later commits are the acceptance script and a tool check, no application code |
| Images                   | built and pushed for this exact sha                                                                                         |

```
ghcr.io/greenarrow-7/master-suit/web:b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
  @sha256:4ffc0f5911b001fa3b81066594f4be480e07d2f71123cc409cfd34566bbfb882
ghcr.io/greenarrow-7/master-suit/worker:b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
  @sha256:52c8c33fa096796563f649ae23dd47d5a0d3cd46b2f57e341fee3354ab5a7a62
```

Zero migrations means step 3 of acceptance applies nothing and the rollback
rehearsal is trivially safe: the previous image runs on an unchanged schema.

## STAGING — acceptance, which writes the marker

On the staging host, as the account that owns the stack. Take the six digits
showing on the platform owner's authenticator **immediately before** running
it; the code rotates every 30 seconds and a stale one is refused.

```bash
cd /opt/master-saas && git fetch origin && git checkout b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
```

```bash
PLATFORM_OWNER_TOTP=<six digits> /opt/master-saas/docs/release/staging-acceptance.sh b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
```

It refuses before touching anything unless staging is provably not production:
a staging database name that is not `leadflow`, `APP_ENV=staging`, the live
database asked for its own name rather than trusted from a string, a postgres
container that is not `infra-postgres-1`, and `SMTP_HOST` on Mailpit or
loopback so the synthetic accounts cannot email real addresses.

Then it creates its own workspace and administrator, settles the
administrator's password, writes a synthetic lead, proves a second workspace's
administrator is refused that lead on read **and** write, checks the worker's
sweeps, round-trips a document byte-for-byte, runs the previous image against
the candidate schema, and only then writes:

    /var/lib/master-suite/tested.b903edc04a81

If any step fails it exits non-zero and writes no marker. Do not create that
file by hand — it is the only evidence that acceptance happened.

## PRODUCTION — preflight, then deploy

Owner only.

```bash
sudo /opt/master-saas/docs/release/production-release.sh preflight b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
```

```bash
sudo /opt/master-saas/docs/release/production-release.sh deploy b903edc04a81e6ba664f3fa8e6c0e3ce418e89af
```

Preflight pulls the images, checks their ids against the marker, runs the
staging-first migration gate, takes a backup and rehearses the restore.
Deploy refuses unless preflight finished and the marker exists.

**Migration count for this candidate: 0.**

## After it is live

`docs/qa/IPHONE-BLANK-SCREEN-REPRO.md` — the steps for whoever holds the
phone. The build shown at the top of their Diagnostics screen must read
`b903edc04a81` or later, which is how you know the recording build is the one
on the device.

Until a report comes back from that phone, the blank screen is **not fixed**
and nothing here says otherwise. This candidate ships the instrument, not the
cure.
