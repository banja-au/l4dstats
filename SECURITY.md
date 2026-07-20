# Security policy

L4DStats processes untrusted binary files and potentially sensitive behavioral
telemetry. Its security boundaries and known risks are documented in the
[threat model](docs/THREAT_MODEL.md).

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's **Report a
vulnerability** button on this repository's Security tab to submit a private
report. If that option is unavailable, open a public issue containing no
security details or sensitive data and ask the maintainers to establish a
private channel.

Include, where possible:

- the affected component and version or commit;
- impact and the conditions required to reproduce it;
- a minimal synthetic reproduction; and
- any suggested mitigation.

Never submit real demos, archives, player identifiers, databases, credentials,
source map assets, clips, or private telemetry. Please allow maintainers time to
investigate and coordinate a fix before publishing details.

## Scope and responsible use

High-value reports include archive traversal or decompression-bomb bypasses,
authentication or authorization failures, secret or identifier exposure,
resource-limit bypasses, and provenance or artifact-integrity failures.

Do not use L4DStats output as the sole basis for punitive action. Findings are
review signals, not cheating verdicts, and the project does not support
automated enforcement or public accusation.
