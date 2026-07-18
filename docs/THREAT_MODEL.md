# Threat model

| Threat                    | Control                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF through user URL     | HTTPS only, exact host allowlist, validate every redirect and resolved address                                                               |
| Oversized/slow response   | connect/read deadline, streamed byte cap, concurrency cap                                                                                    |
| ZIP slip/symlink          | reject absolute, parent, duplicate, symlink, device, and ambiguous paths                                                                     |
| Decompression bomb        | entry count, per-entry, total expanded size, and compression-ratio caps                                                                      |
| Malformed demo parser DoS | bounded reads/allocation, shell-free child, deadline/output/rlimits, seccomp network denial, Node permissions, TERM-to-KILL cleanup, fuzzing |
| Duplicate/replayed jobs   | SHA-256 + engine/config version idempotency key                                                                                              |
| Artifact substitution     | immutable content addresses and derivation manifests                                                                                         |
| Direct API access         | constant-time bearer authentication in production; database readiness alone remains public                                                   |
| Private web exposure      | single- or multi-user Basic gate, viewer/reviewer/admin roles, trusted tunnel/TLS requirement, hardened headers                              |
| Mutation abuse            | bounded process-local windows keyed by verified proxy identity; caller-supplied identity headers are stripped                                |
| Player privacy harm       | minimize identifiers, private access gate, audit, no public accusations                                                                      |
| Model overconfidence      | quality gate, calibration, uncertainty, counterevidence, human review                                                                        |
| Data poisoning/leakage    | provenance, label policy, player/time-separated evaluation                                                                                   |
| Threshold gaming          | publish methodology and calibration, not necessarily live operational cutoffs                                                                |

The bundled roles and identity-aware quotas support a small private team behind
TLS or a trusted encrypted tunnel. Before public deployment, prefer an external
identity provider, add durable distributed quotas, a dedicated no-network
ephemeral parser container as an additional layer, hosted monitoring, a
disclosure contact and an abuse review.

The parser child receives only locale/path/time settings and its pseudonym key,
not API or web credentials. Production Linux fails closed unless the compiled
`parser-no-network` launcher exists. That launcher validates the syscall
architecture, sets `no_new_privs`, denies socket creation, socket pairs,
`io_uring`, BPF and ptrace through seccomp, then executes Node. The stable
[Node permission model](https://nodejs.org/api/permissions.html) allows reads
only from application code and the exact content-addressed demo. Filesystem
writes, child processes, worker threads and native addons remain denied.

The CLI also has a 4 GiB V8 heap cap. `prlimit` caps address space at 5 GiB, CPU
at 300 seconds, open files at 64 and core dumps at zero. Standard output plus
standard error is bounded to 16 MiB. Cancellation, timeout or output overflow
terminates the entire child process group, waits up to one second, then sends
`SIGKILL`. Production Compose caps the worker container at 6 GiB and 256
processes. A real CEDAPug derivation-v6 bundle passes through this exact compiled
boundary. Public high-risk operation can still add a separate ephemeral parser
container as another layer against a Node runtime or kernel vulnerability.
