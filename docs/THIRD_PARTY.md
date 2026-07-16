# Third-party and reference inventory

| Component                                                                         | Use                                      | License/status                                                   | Decision                                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`saul/demofile`](https://github.com/saul/demofile)                               | Parser research                          | MIT; archived 2026-04-28                                         | Not adopted; CS:GO-specific protocol/model                                           |
| [`NeKzor/sdp`](https://github.com/NeKzor/sdp)                                     | Parser design research                   | MIT; commit tested `20a965958e64780718235ad150801a214150c276`    | Candidate reference only; L4D2 message parsing failed empirically                    |
| [`UncraftedName/UntitledParser`](https://github.com/UncraftedName/UntitledParser) | Independent L4D2 header/frame reference  | MIT; commit inspected `c7bd376e68cbf693071a652847eccb1d9d76eca7` | Reference tooling; no L4D2 entity support                                            |
| [Valve Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013)         | Canonical public format/header reference | Valve SDK license; redistribution restrictions                   | Consult behavior/header declarations only; do not copy implementation                |
| CEDAPug demo archive                                                              | Public test inputs                       | Publicly downloadable; redistribution terms not stated           | Keep raw ZIP/DEM ignored and local; track only provenance, hashes, minimized headers |

Runtime JavaScript dependencies and their resolved licenses remain recorded by `pnpm-lock.yaml`; an SBOM/license automation gate belongs to Sprint 5.
