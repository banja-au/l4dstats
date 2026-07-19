# ADR 0012: bounded public Steam player history

## Status

Accepted, 2026-07-19.

## Context

L4DStats reports already retain SteamID64 and display identity when a valid
Source `userinfo` record is available. Reviewers need to find the retained
games in which a known Steam profile appears without enumerating every game or
downloading every analysis artifact.

Steam vanity profile URLs cannot be resolved locally. Valve documents
`ISteamUser/ResolveVanityURL` as a server-side Web API call requiring a Web API
key. That credential must never be sent to the browser or written to logs.

## Decision

- Index only valid individual SteamID64 values already present in an accepted,
  provenance-stamped analysis.
- Store the latest bounded display name plus associations to durable game,
  job, demo hash, and map records in Turso. Never infer an identity from alias,
  slot, user ID, or approximate name matching.
- Expose one exact lookup endpoint. Do not expose a player directory, prefix
  search, or bulk enumeration endpoint.
- Accept a bare SteamID64 or a strict HTTPS `steamcommunity.com/profiles/...`
  URL without external resolution.
- Accept a strict HTTPS `steamcommunity.com/id/...` URL only when the hosted
  service has a server-side `STEAM_WEB_API_KEY`. Resolve it through Valve's
  fixed HTTPS API origin with a four-second timeout. User input is only a
  validated vanity segment and can never select an outbound host.
- Return only retained L4DStats game/demo navigation metadata and the canonical
  public Steam profile URL. Detector findings are not summarized in search
  results.
- Lazily index older analyses when their successful job is opened; new
  analyses are indexed before the job is marked successful.

## Consequences

Exact lookup is useful without creating a browsable accusation surface. A
player absent from retained analyses returns `404`; this is not evidence that
the player has never played. Display names may be stale because they are
observations from demos, while the SteamID64 is the stable lookup key.

Vanity resolution is unavailable until an operator adds the Steam Web API key
to the deployment secret store. Numeric identities and numeric profile URLs do
not depend on Valve API availability.

## References

- [Valve Steamworks Web API overview](https://partner.steamgames.com/doc/webapi_overview)
- [Valve `ISteamUser.ResolveVanityURL`](https://partner.steamgames.com/doc/webapi/ISteamUser#ResolveVanityURL)
