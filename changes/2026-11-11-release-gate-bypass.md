# A failed preflight no longer unlocks deploy

## What

`production-release.sh deploy` gated on one thing: that the checkout's HEAD
equalled the SHA it was handed. `preflight` checks out **first** and verifies
everything after, so a preflight that died at any later step still left HEAD at
the candidate — the exact state `deploy` read as "preflight ran".

`preflight` now writes `$STATE/preflight_ok.<tag>` as its **last** act, and
removes any earlier stamp as its **first**. `deploy` refuses without it, and
also refuses when the candidate has no recorded accepted image identities,
checked **before** production is touched rather than after.

## Why

It happened, on 11 November 2026, on this deployment.

```
preflight 83d9a85e...  → checkout OK 83d9a85e...
                       → Error ... ghcr.io/greenarrow-7/master-suit/web:83d9a85e...: not found
deploy    83d9a85e...  → ran
```

The images were absent because `build-images.yml` is a manual
`workflow_dispatch` and nobody had dispatched it for that commit — it was never
on `main`. Preflight died there, which meant **`phase_images`, `phase_gate`,
`phase_backup` and the restore drill never ran**, and `release.sh` built the
images locally on the production host instead of promoting accepted ones.
Production started on an artifact no gate had seen. `phase_verify` then could
not confirm it either, dying on the `tested.<tag>` file that `phase_images`
would have written:

```
sed: can't read /var/lib/master-suite/tested.83d9a85eeb12: No such file or directory
```

The migration step was the one gate that did hold — 126 applied, none pending —
which is why this ended as a process failure rather than an outage.

A successful preflight is now a positive fact on disk rather than an inference
from a side effect. The stamp is cleared at the start of every preflight, so a
preflight that fails anywhere invalidates the previous verdict instead of
leaving it to be mistaken for this one.

## Where

- `docs/release/production-release.sh` — `stamp_for`, the `rm -f` at the top of
  `phase_checkout`, the write at the end of `preflight`, and the two refusals in
  `deploy`.

## Behaviour

- `deploy <sha>` without a completed `preflight <sha>`:
  `STOP: no successful preflight for <sha> (/var/lib/master-suite/preflight_ok.<tag> is absent). Run preflight and let it finish.`
- `deploy <sha>` for a candidate that never went through staging acceptance:
  `STOP: no accepted image identities for this candidate; it has not been through staging acceptance`
- A preflight that succeeds end to end behaves exactly as before.

## Verified

`bash -n` clean. The two refusal paths are plain `[ -r ]` tests on files whose
names are derived the same way `phase_images` and `phase_verify` already derive
them, so they cannot disagree about which tag they mean.

## Left open

**This does not make the candidate's images exist.** The underlying reason
preflight failed is that `build-images.yml` must be dispatched for a commit
before that commit can be released, and nothing reminds anybody. A release that
begins by dispatching the image build, or a preflight that dispatches it and
waits, would close that; neither is this change.

The deployed release also has **no backup from immediately before it**, because
`phase_backup` was skipped. That is a one-off to repair on the host, not a code
change.
