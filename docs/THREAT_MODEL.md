# Threat model

| Threat                    | Control                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| SSRF through user URL     | HTTPS only, exact host allowlist, validate every redirect and resolved address |
| Oversized/slow response   | connect/read deadline, streamed byte cap, concurrency cap                      |
| ZIP slip/symlink          | reject absolute, parent, duplicate, symlink, device, and ambiguous paths       |
| Decompression bomb        | entry count, per-entry, total expanded size, and compression-ratio caps        |
| Malformed demo parser DoS | bounded reads/allocation, cancellation, subprocess resource limits, fuzzing    |
| Duplicate/replayed jobs   | SHA-256 + engine/config version idempotency key                                |
| Artifact substitution     | immutable content addresses and derivation manifests                           |
| Player privacy harm       | minimize identifiers, access control, retention, audit, no public accusations  |
| Model overconfidence      | quality gate, calibration, uncertainty, counterevidence, human review          |
| Data poisoning/leakage    | provenance, label policy, player/time-separated evaluation                     |
| Threshold gaming          | publish methodology and calibration, not necessarily live operational cutoffs  |

Before public deployment add authentication, authorization, rate limiting, quotas, malware isolation, retention automation, backups, disclosure contact, and an abuse review.
