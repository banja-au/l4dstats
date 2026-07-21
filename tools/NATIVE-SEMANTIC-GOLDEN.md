# Native semantic golden

`native-semantic-golden.ts` verifies the complete authorized 22-demo corpus
without recording paths, filenames, player identifiers, observations or demo
contents. The committed manifest contains only each demo SHA-256, byte count and
canonical prepared-projection semantic SHA-256, sorted by demo hash.

The version-1 semantic hash excludes `parser` and `parserVersion`, whose native
build lineage changes between builds. It also excludes the append-only
perspective, recorder-command and concise-damage fields introduced by compact
wire version 2. Every field that existed in the version-1 prepared projection
remains covered, so the historical manifest continues to prove SourceTV
compatibility instead of being silently regenerated for the new schema. The
new fields have focused contract tests and player-POV corpus validation. The
manifest records its honest basis: TypeScript equality was proved historically
for all 22 demos and recorded in the Rust sprint ledger; routine verification
is now a native regression and does not rerun the deleted TypeScript parser.

Pass every ignored demo explicitly. Paths are used only for that process and are
never emitted:

```bash
pnpm exec tsx tools/native-semantic-golden.ts verify \
  --manifest docs/sprints/native-semantic-golden-v1.json \
  --demo /ignored/one.dem # repeat --demo exactly 22 times
```

Generation uses the same arguments with `generate` and refuses to overwrite an
existing file. Generate only after the native projection is declared stable.
