# ADR 0013: Hosted developer API and account boundary

## Status

Accepted, 2026-07-19.

## Context

The public web application already has bounded upload, queue, parser, Turso and
R2 boundaries. A developer API should reuse those controls without exposing
browser sessions as API credentials, creating a second parser path, or making
private source objects durable.

## Decision

- Build the developer console as an independent React, TypeScript and Tailwind
  application, shipped under the existing Cloudflare Worker asset manifest.
- Host the console at `developers.l4dstats.gg` while only the `l4dstats.gg`
  Cloudflare zone is available. `developers.l4dstats.com` can be attached to the
  same service after that domain is registered and activated.
- Store developer accounts, sessions, API-key hashes, daily counters, bounded
  request logs and upload ownership in Turso. Passwords use PBKDF2-SHA-256 with
  unique salts and the Cloudflare Workers WebCrypto maximum of 100,000
  iterations. This is below OWASP's general PBKDF2-HMAC-SHA-256 preference but
  meets its ASVS typical minimum; authentication is additionally throttled by
  account/IP and passwords are bounded to 12–128 characters. Session cookies
  are `HttpOnly`, `Secure` and `SameSite=Lax`; state-changing console requests
  require the exact Origin.
- Show API keys once, retain only SHA-256 hashes and a display prefix, and allow
  at most five active keys per account.
- Enforce 100 authenticated API requests per UTC day with an atomic Turso
  upsert. Each response carries a request identifier and each account can view
  only its own bounded log entries.
- Create one to ten short-lived, account-owned upload grants per batch. Every
  grant fixes the safe filename, byte count and SHA-256 before streaming. The
  existing upload, private R2 staging, Queue, Container parser, artifact and
  delete-after-extraction transaction remains the only analysis path.
- Permit an account to retrieve only jobs created through one of its grants.
  Successful job responses contain the complete existing versioned parser
  result and lineage.

## Consequences

Developer traffic and browser traffic share parser capacity and artifact
semantics, while authentication, quotas and ownership remain separate. A batch
does not buffer ten demos in a Worker: clients create up to ten grants, then
stream each object independently. The initial account system deliberately omits
teams, billing and delegated access.

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP ASVS credential-storage controls](https://cornucopia.owasp.org/taxonomy/asvs-4.0.3/02-authentication/04-credential-storage)
