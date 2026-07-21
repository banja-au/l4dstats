# ADR 0008: Reconstruct games from demo-internal continuity evidence

Status: accepted

## Decision

Treat an L4D2 game as an ordered collection of per-map SourceTV or player-POV demos. Do not
use filenames as identity evidence. L4D2 SourceTV demos do not expose a
universal match UUID, so grouping remains an explicit reconstruction with a
confidence label and retained reasons.

Each artifact retains:

- an HMAC of the embedded SourceTV server identity;
- a hash of the sorted privacy-safe stable-human-roster tokens;
- the Source `svc_ServerInfo.serverCount` generation value;
- the campaign code and chapter ordinal parsed from the embedded map name; and
- the extraction rules that supplied those values.

Official `cXmY` names and conservative custom prefix/ordinal names such as
`hf04_escape` supply campaign/chapter lineage. Custom campaign codes are
namespaced (`custom:hf`) so they cannot collide with official campaigns.

Two maps normally join when server token, roster token, and campaign agree and
their server-generation values are adjacent. When a substitution or spectator
change alters the whole-roster hash, they may still join only if chapter and
server generation are both exactly adjacent and the stable identity sets share
at least four members and 75% of the smaller set. Repeated chapters or server
generations remain separate. A single map is provisional. Two or more
compatible maps are high confidence. Missing identity evidence produces an
unassociated one-map game rather than a speculative merge.

Game identifiers are local random UUIDs. The API exposes the ordered aggregate
at `/api/games/:id`; the web report uses `/game/:id/:tab`. Map inclusion is a
view scope, so disabling a map recalculates every tab without changing the
stored game.

## External source groups

ADR 0014 adds an operator backfill boundary for a narrowly configured external
catalog. A source adapter may expose a provider-issued match key separately from
the canonical demo hash. After a settlement window and successful processing of
every catalog member, that key may associate same-match segments that cannot be
joined from demo telemetry alone, including two recordings of one chapter.

This is not filename-independent embedded evidence. The hosted game retains an
`external-source-group:<source>` evidence label, rejects conflicting embedded
campaigns, and does not upgrade confidence merely because the source key
matches. Provider grouping rules are adapter-specific and require their own
tests and provenance. Ordinary browser uploads continue to use only the
embedded continuity decision above. When either path merges provisional game
UUIDs, durable aliases preserve all previously issued game URLs.

## Real sample proof

The eight demos in the ignored `tmp/demos` corpus produce exactly three groups
without reading their filenames:

| Embedded maps                               | Source server counts | Result                   |
| ------------------------------------------- | -------------------- | ------------------------ |
| `c7m1_docks`, `c7m2_barge`                  | 4, 5                 | one high-confidence game |
| `c4m1_milltown_a` through `c4m4_milltown_b` | 2, 3, 4, 5           | one high-confidence game |
| `c10m1_caves`, `c10m2_drainage`             | 2, 3                 | one high-confidence game |

Within each group the eight-person stable roster and protected server token are
identical. Both tokens differ across the three groups.

## Limits

- A server hostname alone is never sufficient because server slots are reused.
- An identical roster alone is never sufficient because rematches happen.
- Missing maps can prevent automatic joining when generation values are not
  adjacent.
- A same-roster rematch on the same server and campaign can be ambiguous when
  no trustworthy recording timestamp is available. The system must prefer a
  separate or provisional group over silently combining overlapping campaign
  sequences.
- Team names and roster-to-score-index mapping remain separately unvalidated.

These limitations must stay visible in `DEMO-DATA.md` whenever the grouping
rules change.
