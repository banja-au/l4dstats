# Third-party and reference inventory

| Component                                                                         | Use                                       | License/status                                                   | Decision                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`saul/demofile`](https://github.com/saul/demofile)                               | Parser research                           | MIT; archived 2026-04-28                                         | Not adopted; CS:GO-specific protocol/model                                           |
| [`NeKzor/sdp`](https://github.com/NeKzor/sdp)                                     | Parser design research                    | MIT; commit tested `20a965958e64780718235ad150801a214150c276`    | Candidate reference only; L4D2 message parsing failed empirically                    |
| [`UncraftedName/UntitledParser`](https://github.com/UncraftedName/UntitledParser) | Independent L4D2 header/frame reference   | MIT; commit inspected `c7bd376e68cbf693071a652847eccb1d9d76eca7` | Reference tooling; no L4D2 entity support                                            |
| [Valve Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013)         | Canonical public format/header reference  | Valve SDK license; redistribution restrictions                   | Consult behavior/header declarations only; do not copy implementation                |
| CEDAPug demo archive                                                              | Public test inputs                        | Publicly downloadable; redistribution terms not stated           | Keep raw ZIP/DEM ignored and local; track only provenance, hashes, minimized headers |
| [`snappyjs`](https://github.com/zhipeng-jia/snappyjs)                             | Bounded Source string-table decompression | MIT; pinned `0.7.0`                                              | Runtime dependency behind explicit compressed/output-size limits                     |

Runtime JavaScript dependencies and their resolved licenses remain recorded by
`pnpm-lock.yaml`. `pnpm security:check` fails on known dependency
vulnerabilities or any license category outside the reviewed allowlist in
`scripts/check-licenses.mjs`. The current categories are Apache-2.0,
BSD-3-Clause, BlueOak-1.0.0, CC-BY-4.0, ISC, MIT, MPL-2.0 and OFL-1.1.
Dependency approval does not select a license for this repository or establish
redistribution rights for local CEDAPug demos, Valve assets or extracted maps.
