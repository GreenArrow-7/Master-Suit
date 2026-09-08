# SPEC-0005 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Data class | **biometric capture references** |
| Date | 2026-09-08 |
| Accepted by | — **UNRESOLVED**, Application Security |

The asset is not the key. The asset is a **biometric image of an employee**,
encrypted at rest, whose deletion is a legal obligation. The key is the only
thing that connects a database row to that file, so a key that cannot be
resolved is a file that cannot be deleted.

## Trust boundaries

| Boundary | Crossing |
|---|---|
| database ↔ service | `capturePath` read back as a string; **untrusted input at this boundary** |
| service ↔ local filesystem | `path.resolve(root(), key)`, containment-checked |
| service ↔ object storage | `PREFIX + key` |
| host ↔ host | a key written on one platform read on another |

**The database is a trust boundary.** A stored key is data, not a promise. This
change adds normalisation *at* that boundary, which is exactly where a
traversal would be introduced if it were done carelessly.

## Threats

| # | Threat | Vector | Impact | Control | Residual |
|---|---|---|---|---|---|
| `TH-001` | **Silent deletion failure** — the sweep reports success having deleted nothing | Windows-written key read on POSIX: `objectKey` normalises with the running host's `path.sep`, so the object key addresses nothing, and the on-disk fallback's `ENOENT` is swallowed as "already purged" | **Legal.** Retention and PDPL deletion obligation unmet, with no signal that it was | `FR-011` backward-compatible read; `AC-005` | Captures already orphaned by this defect are not recovered by the fix — `CL-002` |
| `TH-002` | **Orphaned biometric image** — the punch row is deleted and the encrypted frame is not | `retention.ts:306-315` calls `deleteCapture`, which returns normally, then deletes the row | Biometric data persists in the bucket with **its only index removed** | `FR-011`; retention regression test | Finding existing orphans needs a bucket-versus-database reconciliation, out of scope here |
| `TH-003` | **Path traversal via normalisation** | a stored key containing `..`, introduced by a future defect or a tampered row | **Arbitrary file read or delete** outside the vault | `SEC-001` refuse; `SEC-002` containment check retained; `FR-005` | The containment check is the backstop and is unchanged |
| `TH-004` | **Separator confusion** — `\` treated as a separator on one host and a literal on another | mixed-separator key | Wrong file resolved, or none | Canonical composition `FR-001`; normalise-for-resolution only `FR-012` | — |
| `TH-005` | **Absolute-path injection** — `/etc/passwd` or `C:\Windows\...` in the key | tampered row, or a future composition defect | Read or delete outside the vault | `FR-004`, `SEC-001` refuse before resolution | — |
| `TH-006` | **UNC path** — `\\server\share\...` on Windows | tampered row | Reaches a network location | `SEC-001` refuse; a UNC prefix is not a valid key | Windows-specific; must be tested explicitly |
| `TH-007` | **Drive-relative path** — `C:file` | tampered row | Resolves against a per-drive cwd | `SEC-001` refuse | — |
| `TH-008` | **Tenant crossover** — a key resolving into another tenant's subtree | `..` segments, or an encoded separator | **Cross-tenant biometric exposure** | `SEC-003`; `FR-005`; shard order `FR-006` | Highest-severity outcome; explicitly tested |
| `TH-009` | **Double decoding** — normalising twice turns `%2e%2e` or `..%2f` into a traversal | a key normalised once then again | Traversal | Normalise once, then validate; never validate then normalise | The order is the control; a test pins it |
| `TH-010` | **Incorrect canonicalisation** — collapsing `//` or `.` changes which file is named | duplicate or empty segments | Wrong file | `FR-005` refuse rather than collapse | Refusing is safer than repairing |
| `TH-011` | **Filesystem escape via symlink** | a symlink inside the vault | Read or delete outside | Existing containment check on the resolved path | Pre-existing behaviour, unchanged by this specification |
| `TH-012` | **Stale database references** — rows pointing at files that no longer exist, or the reverse | historical writes from a non-POSIX host | Retention reports success having deleted nothing | `FR-011` | **Extent `UNKNOWN — requires runtime/infrastructure verification`** |
| `TH-013` | **Migration incompatibility** — a fix that makes old keys unreadable | write-forward without backward-compatible read | Existing captures unreachable **and undeletable** | `FR-011`, `FR-012`; `AC-003` | This is why compatibility precedes any migration |
| `TH-014` | **Auditability loss** — a deletion sweep that silently resolves nothing | key that resolves to no file | "Deleted" reported without deleting | `OBS-001` counts refusals | A count is not an alert; alerting is out of scope |
| `TH-015` | **Key disclosure through logs** | logging a refused key | A key carries tenant and employee identifiers | `SEC-005`, `OBS-001` — reason logged, key not | — |

## What is not claimed

**No deployed impact is known.** No production or staging database was
contacted by this workstream, and none may be. Whether any deployed row holds a
backslash key, and whether any capture is currently unreachable, is:

> **UNKNOWN — requires runtime/infrastructure verification.**

The local development database holds **0** `HrAttendancePunch` rows, which
proves only that the local database is empty.

The assessment that would answer it is prepared in `clarifications.md` and is
**not executed**.

## Controls this change must not weaken

Three controls exist today and must be identical afterwards. They are listed so
a reviewer can check them rather than take the claim:

1. `path.resolve(root(), relative)` followed by a containment check against
   `root()` — lines 147/148 and 187/191.
2. Ciphertext content type, so a browser never treats a capture as an image.
3. Tenant-first sharding, so one workspace's captures stay one subtree.

## Severity

`TH-008` — cross-tenant biometric exposure — is the highest severity and the
least likely. `TH-001` and `TH-012` are the most likely and carry legal rather
than confidentiality impact.

**That combination is what makes this `R4`**: the defect is trivial, the data is
biometric, and the failure mode is a deletion obligation that reports success.
