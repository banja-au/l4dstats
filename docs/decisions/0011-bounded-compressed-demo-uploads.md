# ADR 0011: Bounded compressed-demo uploads

- Status: accepted
- Date: 2026-07-19

## Context

SourceTV demos compress well and browser users commonly retain them as ZIP,
gzip, xz, bzip2 or Zstandard files. Expanding attacker-controlled input in the
Cloudflare parser container creates path traversal, archive confusion,
decompression-bomb, CPU, memory and provenance risks. Passing an archive to the
native parser would also blur the existing bytes-only `.dem` trust boundary.

## Decision

The hosted upload boundary accepts only a raw `.dem` or one of these explicit
single-demo names: `.dem.zip`, `.dem.gz`, `.dem.xz`, `.dem.bz2`, `.dem.zst`.
Generic `.zip`, tar, 7z, nested compression and extension polyglots are rejected.

Before the parser runs, the container independently verifies:

1. the uploaded object's declared length and SHA-256;
2. a safe basename and an exact supported suffix;
3. compression magic matching that suffix;
4. at most 100 MiB of compressed input and 100 MiB of expanded demo data;
5. a maximum 100:1 expansion ratio;
6. for ZIP, at most 16 entries and exactly one top-level `.dem`, with no links,
   encryption, traversal, unsupported method, directory ambiguity or extra
   member;
7. bounded output for every decoder, plus a 30-second wall limit and process
   address/CPU limits for xz and bzip2; and
8. the `HL2DEMO\0` Source demo signature after expansion.

Only the expanded demo bytes are written to the random, mode-0700 job directory
and passed to the existing sandboxed parser. Both the uploaded-object SHA-256
and extracted-demo SHA-256/size remain in the hosted job/analysis lineage. The
temporary compressed source and expanded working file follow the same
delete-after-extraction policy as raw demos.

## Consequences

- Compression saves client bandwidth without weakening the native parser
  boundary or permitting filesystem extraction.
- A ZIP containing multiple demos is rejected; users upload each demo as one of
  the ten independent inputs so job identity, progress and failure remain clear.
- The same demo compressed differently initially has a different upload
  idempotency key. The durable analysis still uses the extracted demo hash.
- Supporting tar, 7z, multiple-member archives or client-side expansion requires
  a new threat review and is not implied by this decision.
