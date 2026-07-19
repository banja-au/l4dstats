# ADR 0007: derive browser map geometry locally from Steam-distributed BSPs

- Status: accepted for implementation
- Date: 2026-07-17
- Amended: 2026-07-19

## Decision

L4DStats will render real map geometry from a **local, versioned L4D2 map
installation**, not from the demo and not from map images copied into this
repository. The recommended zero-host-setup source is the Left 4 Dead 2
Dedicated Server (Steam application `222860`), installed anonymously by
SteamCMD into a named Docker volume.

An offline build step will read only the matching `maps/<map>.bsp` and emit a
small analytical mesh artifact. The artifact will contain:

- the canonical map name and SHA-256 of the source BSP;
- Steam app ID and Steam build identifier when an app manifest is available,
  plus extractor and format versions;
- triangulated world-brush faces and displacement surfaces in Source world
  coordinates, with bounded indices;
- coverage counts for sky/nodraw faces omitted during extraction;
- bounds and a quantized centroid Z value for each triangle.

It will not contain textures, lightmaps, models, sounds, entity text, or the
source BSP. The API serves the derived artifact only to the local L4DStats
instance. The web viewer uses an orthographic top-down camera by default and
may offer an analytical 3D tilt. Demo event positions remain in unmodified
world coordinates and are overlaid directly on the mesh.

Source BSPs and other game assets are never committed. Following project-owner
legal review, bounded derived mesh JSON may be committed when it contains no
textures, lightmaps, models, sounds, entity text, BSP bytes, or other source
assets and retains the source BSP hash, source byte count, Steam build ID when
available, content root, extractor version, map revision, coverage, and catalog
lineage. The initial committed scope is the five Parish chapters. A demo does
not carry the source BSP hash or Steam build identifier, so resolving an
artifact by map name does not prove that it is the exact map revision used by
the recorded server. The UI must expose this version limitation.

Development resolves geometry in precedence order: the writable local cache
first, then the committed derived subset. This preserves local full-installation
and custom-map overrides while making covered maps available on a fresh clone.

## Why this is feasible without an installed game

Valve's Steamworks documentation says dedicated-server tools are normally
added to SteamCMD's anonymous package and downloadable without a signed-in
game owner. L4D2's dedicated server is distributed as app `222860` and carries
the server maps required to host official campaigns. This is a download into
the L4DStats container/volume; it is not vendoring or redistribution by this
project.

A `.dem` header identifies the map but contains no static level mesh. Source
stores compiled map content in BSP files. A Source BSP is a lump container;
world geometry can be reconstructed from vertices, edges, surfedges, faces,
models and displacement lumps. Potential visibility data is not itself render
geometry. A NAV mesh is useful for route/progress overlays but is intentionally
not the geometry source: it describes navigable areas and omits walls, roofs,
props and non-walkable scenery.

## Acquisition and cache flow

```text
demo header map name
       |
       v
local geometry catalog --missing--> opt-in SteamCMD app_update 222860
       |                                  |
       |                            named asset volume
       v                                  v
map + BSP SHA-256 ----------------> bounded BSP extractor
                                         |
                                  provenance-stamped mesh
                                         |
                                 local API -> WebGL/canvas
```

Asset installation must be opt-in (`pnpm maps:install` or a Compose profile),
because the server depot is materially larger than this application. Normal
development and demo analysis must continue without it. SteamCMD is image
digest pinned. The Steam build ID is recorded when SteamCMD writes an app
manifest. Installers that expose only a depot manifest must not invent an app
build ID. Every mesh always records the source BSP SHA-256, which is the
authoritative identity for its input bytes. The v1 local cache is keyed by map
name and is replaced on re-extraction. Analyses do not yet pin a historical
mesh artifact, so the API uses the mesh artifact hash as its ETag and exposes
the source BSP hash separately. Content-addressed retention is required before
an analysis can claim durable map-asset lineage.

The extractor also writes a local `l4dstats-map-catalog-v1` inventory. Source
search paths are resolved in engine precedence, with `update` overriding DLC
and base directories when a canonical map name occurs more than once. Each
entry records the canonical map, selected logical content root, BSP hash and
byte length, BSP/map revision, emitted triangle count, extractor version, and
Steam build ID when the app manifest exposes one. The official installation
workflow requires exactly the 57 c1-c14 campaign chapters and reports every
missing chapter. It excludes auxiliary and test BSPs, including the c5m1 sound
scape helper. A separate validation command re-hashes each selected BSP and
checks provenance, mesh dimensions, finite coordinates and heights, indices,
bounds, and coverage without loading every mesh into memory at once.

Official installation artifacts use source kind `steam-dedicated-server`, app
ID `222860`, and the logical content root. A Steam build ID is included only
when an app manifest supplies one. A one-off custom BSP uses source kind
`local-bsp` and does not falsely claim a Steam app or build.

## Extractor safety and correctness gates

The extractor is an independent, narrow implementation. Valve Source SDK code
may be consulted as a format reference but must not be copied: Valve publishes
that repository under a restrictive SDK licence, not this project's eventual
licence. Any third-party BSP library requires a pinned version, compatible
licence review, isolation, and corpus comparison before adoption.

Required gates:

1. Validate `VBSP`, supported L4D2 BSP version(s), all 64 lump descriptors,
   offsets, lengths, element counts and decompression limits before allocation.
2. Support uncompressed and observed LZMA-compressed lumps; fail closed on
   unknown versions. Never execute or render embedded HTML/material scripts.
3. Reconstruct ordinary world faces from vertex/edge/surfedge/face/model data,
   including signed surfedge orientation and deterministic triangulation.
4. Reconstruct bounded power 2–4 displacement faces from displacement
   info/vertices. Report malformed or unsupported face kinds as coverage,
   never silently omit them.
5. Generate synthetic/corrupt fixtures in tests (no Valve asset committed),
   then validate bounds, triangle counts and sampled coordinates against at
   least one locally installed official map.
6. Record per-map coverage: decoded/rejected faces, displacements, static props
   omitted, and whether dynamic occluders are unavailable.
7. Keep rendering claims separate from line-of-sight claims. Static world mesh
   alone does not make visibility authoritative because doors, breakables,
   props and demo-time dynamic state may matter.

Compressed geometry lumps use Valve's Source LZMA1 wrapper. The extractor
validates its magic, compressed length, directory and wrapper uncompressed
sizes, dictionary size, and cumulative decoded bytes before decoding. It then
converts the payload to a standard `.lzma` container for the pinned
`@napi-rs/lzma@1.5.1` decoder. The dependency is MIT licensed, actively
maintained, provides prebuilt Node binaries for the supported development
platforms, and avoids copying restrictive Source SDK decoder code. Every mesh
records the codec, exact decoder version, decoded lump indexes, and decoded
byte total in its coverage provenance.

## Local validation evidence

The 2026-07-17 validation used anonymous dedicated-server depot `222861` and
resolved all 57 official c1-c14 chapters across the base, DLC, and update
content roots. Extraction emitted 2,418,397 vertices and 1,886,327 triangles
from 1,468,287,000 BSP bytes. `validate-installation` independently re-read
every source and artifact, verified all source hashes and byte lengths, and
checked finite arrays, dimensions, indices, bounds, and coverage.

`validate-demo-alignment` then streamed 385,940 player-position observations
from the four `915679` Hard Rain demos. All 385,940 positions fell inside the
XYZ bounds of their map-name-matched official artifacts: 115,686 on c4m1,
118,890 on c4m2, 84,679 on c4m3, and 66,685 on c4m4. The real browser boundary
also switched among all four maps and verified both substantive geometry and
event-marker pixels on every canvas.

These results prove coordinate-system compatibility for that corpus. They do
not prove exact historical BSP revision identity because a demo carries the
map name, not the source BSP hash or Steam build ID.

## Rendering scope

The first useful artifact should be a monochrome, grungy top-down geometry
render with deaths, pins, clears and trails above it. It is genuine BSP-derived
geometry, but not authentic game footage. Multi-level maps require explicit
floor slicing/fading rather than flattening every Z layer into an unreadable
shape. The v1 artifact includes a rounded centroid Z value alongside every
triangle so the browser can slice or fade geometry around an event elevation
without changing Source coordinates. A later stage may add NAV-derived route progress and locally resolved
static-prop collision meshes, each with distinct provenance and coverage.

## Rejected alternatives

- **Extract geometry from the demo:** impossible; static map geometry is not
  embedded in SourceTV demos.
- **Commit official overview screenshots or BSPs:** source game assets remain
  prohibited; the committed analytical JSON contains only bounded derived mesh
  data with explicit provenance.
- **Hotlink community overview images:** availability, alignment, licensing and
  version provenance are not dependable.
- **Use NAV polygons as “actual map geometry”:** misleading and incomplete.
- **Download assets during every analysis:** slow, non-reproducible and an
  unnecessary network dependency. Installation and derivation are separate.
- **Render textures in v1:** greatly expands VPK/VTF/VMT parsing, asset volume,
  security surface and licensing exposure without improving statistical
  comprehension proportionally.

## Primary references

- [Valve Steamworks: Distributing Your Dedicated Game Server](https://partner.steamgames.com/doc/sdk/uploading/distributing_gs) - anonymous SteamCMD distribution model.
- [Valve Developer Community: SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) - official tool workflow and `app_update` operation.
- [Valve Developer Community: BSP (Source)](<https://developer.valvesoftware.com/wiki/BSP_(Source)>) - Source lump layout and geometry relationships.
- [Valve Developer Community: Source SDK files and directory structure](https://developer.valvesoftware.com/wiki/Source_SDK_Files_and_Directory_Structure) - compiled `.bsp` map-content role.
- [Valve Developer Community: Navigation Meshes](https://developer.valvesoftware.com/wiki/Navigation_Meshes) - NAV purpose and generation.
- [ValveSoftware/source-sdk-2013](https://github.com/ValveSoftware/source-sdk-2013) - authoritative engine-format reference and restrictive licence notice; reference only, no copied implementation.

## Consequences

The committed Parish subset works on a fresh checkout. Users can derive the
remaining official-map geometry from a local L4D2 installation; that setup is a
substantial optional download. Map visuals are reproducible for a recorded BSP
hash and use the same Source world coordinate system as demo positions. Exact
map-revision equivalence to a demo remains unverified because the demo does not
identify its BSP bytes. Custom campaigns still require the user to mount their
own BSP. Absence of a matching artifact remains an explicit quality state, not
a reason to fabricate geometry.
