# Corner-arm research source evidence

Checked **2026-09-28 UTC / 2026-09-27 America/Denver** against working tree based on `96ba2e90aed79efae0b44ab7190a53a2bd677700`. This is source evidence for advisory research. It does not qualify a machine, establish continuous clearance, certify hydraulics, or prove controller/native/field behavior. Existing dirty files were preserved; this evidence leaf owns only this document.

Complexity: high; reasoning effort: high. Subagent decision: not useful within this bounded leaf; the coordinator owns other parallel scopes. Gates: current hashes and PDF metadata, semantic workbook reconciliation, primary-source checks, and document review. No package installation, proprietary code copying, vendor binary analysis, project mutation, or aggregate validation belongs to this leaf.

## Local evidence identity

Hashes below were recomputed from the local originals. PDF pages are one-based physical PDF pages unless a printed section is also given. A cover revision does not mean every internal section has that revision. Raw sources remain local; existing curated inventories provide their paths and extraction records.

| Local source and curated pointer | SHA-256 | Pages; cover revision | Evidence role |
| --- | --- | --- | --- |
| [Precision design guide](design-guides/guides/local-precision-corner-0999428.md) | `6507f2555207141309adcb89c3669c4bc40129987a41c10abbad0130696de2d0` | 59; `0999428_G`, 2021 | P5 controls/sensors; p6 terrain compensation; p10 / 2-2 dimensions and reach; p11 / 2-3 drive options. |
| [VFlex design guide](design-guides/guides/local-vflex-corner-0998325.md) | `ecd9ec9b4e81a9725471faee88e70d4ebfba5fce644e9f6b350df0be9a8fb95c` | 90; `0998325_H`, 2021 | P6 orientation; p9 / 1-5 galvanized configuration; p10 / 1-6 poly configuration; p11 tire conditions. |
| [GPS guidance design guide](design-guides/guides/local-gps-guidance-0970012.md) | `885ea94bffd9b31a50e359b0369a711c190935bb55f88cfda67a2f8fe668c967` | 12; `0970012_0`, 2021 | Guidance context; no generic accuracy or clearance guarantee. |
| [Pivot design guide](design-guides/guides/local-pivot-design-0998236.md) | `9e19c886b86ef353ad8f3b050cb8be0ba010720c1159f21f8d2574e53365677e` | 246; `0998236_N`, 2022 | Parent-machine design context, including conditions referenced by corner guides. |
| [Valley Corner service](corner-service-manuals/manuals/local-valley-corner-service.md) | `0b3f00b9532dbfafb04289d0ce2f7cf8da2b880b58d286238110a3fc0cde9248` | 198; 29-Oct-2024 | P29 / 1-3 identifies 170/185 ft family and cyclic LRDU/SDU interaction; section dated 09/2012. |
| [VFlex service](corner-service-manuals/manuals/local-vflex-corner-service.md) | `d7f95585d17af6c6ca759baa546cbbda19503c0719ea9201299507b9d57b599c` | 366; 29-Oct-2024 | Family-specific service evidence; internal dates vary. |
| [Precision service](corner-service-manuals/manuals/local-precision-corner-service.md) | `dfc5cba60e235d2be8820b5a6bd16afd7afba09f53eeeafa1bd6ad98006869ea` | 387; 29-Oct-2024 | Cover/contents identify Smart Board software 1.40; not proof of the installed machine version. |
| [DualSpan service](corner-service-manuals/manuals/local-dualspan-corner-service.md) | `72ff4661265a207b5eb4b41aa212b614f5901c6f588e6c709fe59da1c247c4ec` | 80; 29-Oct-2024 | P25–27 / 1-3–1-5 guidance, nonstraight extension, operation and sequencing; p59–60 connecting-span schematics. |
| [Service-manual index](corner-service-manuals/manual-inventory.md) | `1f2a697f35a8c6da51edb71aa15c4b7f119fa681a3c758f8f65481388222b633` | 1; no cover revision established | Index, not additional design authority. |
| [Scaffold ZIP inventory](corner-arm-artifacts/artifact-inventory.md), `tmp/irrigation_corner_arm_initial_scaffold.zip` | `3ff46c9c2ca3a7f7614f11cbb931b648908c2695eb60cdae506925e4417ffa4f` | Six members, 155,014 bytes uncompressed; scaffold date 2026-06-10 | Workbook, manifest, normalized CSV/JSON, developer guide and research notes. |

The complete [design inventory](design-guides/pdf-inventory.md) also lists linear and Ethernet guides outside this leaf's selected evidence. Two older service originals coexist with the selected files: `DualSpan Corner .pdf` (space before extension), 80 pages, 20-Oct-2023, SHA `d1e5f26d9b8a8c99daa4dbbf4256557afc0e420d266486fb13c917ea207b6f0b`; and `Precision Corner .pdf`, 385 pages, 20-Oct-2023, SHA `ce782c7a247b5427072680504264f772168032b84d69727d7c138bb9fddb4245`. These are separate revisions, not interchangeable filenames. The existing DualSpan curated topic's `page=1` must not be interpreted as the PDF page containing its theory text; current text inspection locates that material at p25–27.

### Workbook reconciliation

Read-only method: Python standard-library `zipfile`, `xml.etree.ElementTree`, `csv`, `json`, and `hashlib`; decoded shared strings and typed/inline cell values. Compared semantic fields and record values, without running formulas or Excel macros. Raw sheet-cell-address diff counts are not meaningful across these layouts.

| Property | Standalone `tmp/Valley Corner Arm Specs_A.xlsx` | ZIP-embedded `Valley Corner Arm Specs_A.xlsx` |
| --- | --- | --- |
| SHA-256 | `e34103f80182c611d33fd34204a2adbfe3b21cb5f9a31514b1bd5fb494d1b4ef` | `1295f6404b5e39dc75c7ca94d759597c352a3665df9535bb66c69b44fa229baf` |
| Layout | `Sheet1`: header + 14 model rows, eight columns, 120 nonempty values | Eight sheets: `README`, `Machine_Inputs`, `Model_Specs_Wide`, `Model_Params_Normalized`, `LRDU_Speed_Table`, `Constraints`, `Sources`, `Data_Dictionary` |
| Model coverage | Precision 205 variants, Precision 185; VFlex 185/205/218 variants including dry-climate and 100-OH labels; Standard 185/170 | Three reference profiles: Precision 185, Precision 205, VFlex 66m/25m; one `USER_MACHINE_SELECTED` placeholder |
| Wide table | Model, corner length, overhang length, max/min corner angle, speed ratio, outward/inward steering | Four data rows, 34 columns: dimensions with units, drive metadata, connection/guidance/sequencing, provenance, flags and QA quantities |
| Machine inputs | No machine-input sheet | 19 input rows, all status `UNCONFIRMED`; only CRS default `EPSG:4326` and output-format default `GeoPackage` have value cells. These are not site qualifications. |
| Normalized records | Absent | 75 records: 56 model parameters + 19 input-schema records; 42 `EXTERNAL_OFFICIAL`, 14 `PROJECT_UNCONFIRMED`, 19 `UNCONFIRMED`; all `production_ready=No` |
| Additional material | No explicit unit/source/status columns | 18 LRDU speed references; 11 constraints; 11 sources; 27 dictionary rows |

Concrete conflicts and non-equivalences:

- Standalone Precision 205: corner length **201**, overhang **86**; embedded nominal span **205 ft**, overhang **82 ft**. Precision 185 is **181 + 86** versus **185 + 82 ft**. Totals match (287 and 267), but component meanings differ. This does not establish an error or a resolved dimensional mapping: the standalone headings lack units and reference-point definitions.
- Standalone VFlex 218 has **214 + 86**; embedded VFlex is **66 m + 25 m** (about 216.535 + 82.021 ft), not an exact counterpart. The design guide additionally distinguishes nominal spans from actual span lengths and galvanized from poly overhangs.
- All 14 standalone rows give corner angles **75–162**. Twelve Precision/VFlex rows give outward/inward values **100/10**; two Standard rows give **95/0**. These lack demonstrated angle convention, units, provenance and serial-specific applicability. The embedded profiles do not supply equivalent qualified mechanical limits. Do not turn these into universal acceptance thresholds.
- Standalone ratios include **1.55**, **2**, and **1.44**; embedded Precision references separate standard **1.55** and water-utilization **2** while leaving VFlex's ratio blank. Dry-climate variants are not preserved as corresponding embedded model rows.
- Embedded Precision `effective_corner_length` is **256/276 ft** (185/205 family), sourced to an owner-manual example. Local design guide `0999428_G` p10 instead labels **254/273 ft** as extension/maximum extended reach. Preserve both named quantities, sources and revisions; no automatic substitution or averaging.
- CSV and JSON contain **zero field-value differences** across all 75 records after treating JSON null as an empty CSV cell. The embedded normalized sheet has header + 75 rows; this does not prove workbook authorship or provenance.

Member hashes: normalized CSV `d4032d4b7312eb22cff8bedd077a72d9eb4476bf6d61311508516c017c4e0d58`; JSON `e0caf2e07d5f7058c700337a521876e1bac4bafff1ba60a233558ccf8eeb1554`; developer guide `ae3c9d55caf5ad58366a423f98fe38b7ec1e786d5a5944a6e4ab1a0f2fa51dfe`; research notes `5112c768ff23c4d5d19bd997aa6906ee2f5e56d3539b77714f6742069b23db22`; manifest `4695db548e56c1414d2908e668f6a084c7b9d8db3633363824b17de3660b294b`.

**Lineage remains unresolved.** Embedded source flags are assertions in the scaffold, not independent verification. Reconciliation neither promotes the standalone table nor upgrades any normalized row to production-ready.

## Public primary sources and machine-family distinctions

All URLs in this document were checked on the date above. Browser retrieval of the three Valmont PDFs failed; direct HTTPS retrieval plus in-memory `pdftotext` succeeded. No downloaded manual was added to the repository.

| Source | Revision / identity | Supported use and limitation |
| --- | --- | --- |
| [Precision Corner owner's manual](https://webassetsprod.valmont.com/valmontproduction/docs/librariesprovider127/i-q/precision-corner-owner%27s-manual.pdf?sfvrsn=be88df39_4) | `0996070_G`, 2019, 90 pages; SHA `bc3bd271e5fb4fbe3dbb7c0284af79488e14eeb57f38eaf732b609a281c9d525` | P28 distinguishes LRDU/SDU movement and span-sensor feedback; p47 labels 256/276 ft effective lengths inside application examples. These are not generic mechanical clearance limits. |
| [VFlex owner's manual](https://webassetsprod.valmont.com/valmontproduction/docs/librariesprovider127/r-z/vflex-corner-owner%27s-manual.pdf?sfvrsn=368ddf39_4) | `0999057_D`, 2019, 44 pages; SHA `6b5b6aca2f9a68d8a2b95887be7639ba1d8aac16dfe7850f72cc0965afd90daf` | Public owner reference; the newer local design guide provides configuration distinctions. No controller-equivalence conclusion. |
| [DualSpan owner's manual](https://webassetsprod.valmont.com/valmontproduction/docs/librariesprovider127/a-h/dualspan-owners.pdf?sfvrsn=7bd8df39_4) | `0998408_E`, 2015, 52 pages; SHA `65c60493a23b14df7ecf5222fc3ff213672517139ee576ff0bbba86b5c6c7a94` | Separate family reference; local service topology is described below. |
| [Valley comparison](https://www.valleyirrigation.com/blog/valley-blog/2019/02/14/expanding-your-irrigated-acres-with-valley-corner-systems) | Manufacturer article, 2019-02-14 | Describes VFlex start/stop with track-and-roller and Precision constant-move with ball-and-socket/VFD; both have guidance/orientation options. Article-level concepts do not replace serial-specific design data. |
| [Lindsay expanded acreage solutions](https://www.lindsay.com/mea/en/irrigation/zimmatic/pivots-and-laterals/expanded-acreage-solutions) | Current manufacturer page; no document revision displayed | Identifies **9500CC2 Custom Corner**, bank control, GPS and VRI options. Does not provide qualified hinge/steering limits, path dynamics or speed ratios. FieldPLUS and 9500DS Drop Span are separately described products. |
| [Lindsay 9500 series brochure](https://www.lindsay.com/uploads/files/resources/311-Lindsay_9500Series_Bro_WEB.pdf) | Manufacturer PDF search evidence names **9500CC Custom Corner** | Older family label exists; this pass does not establish 9500CC-to-9500CC2 mechanical equivalence or a complete revision history. No dimensions admitted from search snippets. |
| [Reinke ESAC](https://reinke.com/products/center-pivot/swing-arm) | Current manufacturer page; linked resource advertises ESAC 6.0 | Lists 290/330 ft lengths, GPS guidance, dual ball-and-socket hinge and end boom. Listed total lengths are not hinge-to-wheel offsets. Page's 1 cm RTK claim is a vendor specification, not field accuracy or a safe buffer. |
| [WO2022271479A1](https://patents.google.com/patent/WO2022271479A1/en) | Published 2022-12-29; flow-management disclosure | Description [0088]–[0089] relates sprinkler flow to speed, overlap and position effects; supports keeping hydraulics separate from geometric reach. A patent disclosure is not deployed-controller validation or permission to implement every claimed feature. |
| [US8886406B2](https://patents.google.com/patent/US8886406B2/en) | Published 2014-11-11; single-antenna guidance disclosure | Claims 1 and 7 describe wheel-associated position and future heading toward a path point. Supports explicit antenna/wheel reference geometry; does not establish a universal tracking tolerance or compatibility. |

| Family | Distinct model evidence | Research boundary |
| --- | --- | --- |
| Valley Corner | Service p29: 170/185 ft family, cradle/roller cycling, steerable drive unit | Keep separate from VFlex and Precision; legacy hardware/control settings need their own machine profile. |
| VFlex | Design p6 and p9–11: standard/inverted, model/profile/material and overhang variants; start/stop relationship in public comparison | Kinematic geometry may share a rigid-link abstraction; timing, steering, rates and clearances cannot be inherited wholesale. |
| Precision Corner | Design p5–6: LRDU/SDU control, angle/span sensors and antenna-to-ground compensation | Nominal span/overhang plus measured offsets, control options and pressure behavior required. |
| Lindsay/Zimmatic 9500CC / 9500CC2 | Two documented labels, current GPS/bank/VRI options | Generic articulated study only until exact generation, configuration and mechanical inputs are sourced. |
| Reinke ESAC | Hinge/end-boom and overall-length options documented | Separate attachment, wheelbase and sensor reference definitions required; no Valley numeric inheritance. |
| DualSpan | Service p25–27: guidance tower and free-standing span, two angle sensors, extension remains nonstraight; p59–60 connecting-span schematics | **Separate topology.** Do not represent it as one longer swing arm or use single-hinge solver acceptance as DualSpan proof. |

## Numeric admission and missing inputs

“Qualified reference” here means the stated source and configuration support that named quantity. It does not mean the value is qualified for an actual project.

| Input | Available evidence | Still required before machine-specific feasibility |
| --- | --- | --- |
| Dimensions and reference points | Local guides have explicit nominal/actual span, overhang and extension quantities; standalone worksheet differs | Serial/configuration, hinge-to-SDU reference, offsets, overhang endpoint and physical widths; reconcile rather than derive dimensions from model labels |
| Parent radius | Scaffold defines pivot-center-to-LRDU intent | Measured/as-built projected radius and hinge offset; total wetted radius is not a substitute |
| Speed/time | Embedded speed table has 18 tire/RPM references with 480 V / 60 Hz conditions; no selected machine speed | Measured LRDU ground speed, tire/gearbox/service options, SDU speed/rate limits and timer/control behavior |
| Joint and steering limits | Standalone numeric candidates; no qualified cross-source convention | Signed angle axes, zero reference, leading/trailing configuration, direction, range and rate constraints with matching evidence |
| Boundary and clearance | Input template only | Surveyed/projected boundary, obstacles, buffers, widths, terrain/height effects, GNSS uncertainty and continuous swept-envelope checks |
| Guidance path | Family guidance concepts, not an approved project path | Path source, projection, orientation, continuity, controller-specific tracking behavior and reversible-direction constraints |
| Hydraulics | Documented sequencing and example flow calculations | Pump curve, available pressure/flow, regulators, sprinkler/nozzle package, overlap and end-gun behavior, required application depth |
| Error budget | No accepted machine-wide values | Separate numerical sampling/chord error, positional uncertainty, tracking error and physical clearance allowances; no inferred generic safe limits |

## Research example excluded from reuse

[Majd Farhat's 2025 Politecnico di Torino thesis](https://webthesis.biblio.polito.it/35388/) lists 81 pages and marks both thesis and attachments **CC BY-NC-ND**. Its [attachment ZIP](https://webthesis.biblio.polito.it/35388/2/allegati.zip), SHA `332759a92ffe76178cb43c8c778c2668419c7a52d31d1eca857b05c513ba7790`, contains three MATLAB files. Read-only inspection of `final thesis/arm_real_data_2.m` (SHA `3449df5388beb7d00091531055ce4fce142bcd4ae6dbc90326025a4eb186e111`) found endpoint coordinate clamping after fixed-length endpoint construction, lines 44–51.

Independent mathematical consequence: at the example's zero-degree sample, the tower is `(1000,500)` and its unbounded tip is `(1207.1,500)`; clipping the tip to the field yields the tower itself, changing the 207.1 m link to zero. Therefore visual containment is not rigid-link feasibility. This example is a failure-mode reference only. No source code is copied, executed, ported or adopted, and its license is not treated as permissive production-code authority.

## Official package evidence and disposition

Local package manifests currently declare `proj4 2.20.8`, `polygon-clipping 0.15.7` and `polyclip-ts 0.16.8`. Imports confirm proj4 in core coordinates, polygon-clipping in corner kinematics/general geometry/placement, and polyclip-ts in the advisory render model. Upstream versions below are observations, **not upgrade instructions**.

GitHub repository metadata, default-branch code and latest-release endpoints were read directly on the check date. `pushed_at` records repository activity, not the date of the cited commit or a maintenance guarantee. All ten repositories reported `archived=false`. No popularity metric was used. Each package still needs pinned dependency/notice review and local correctness tests if adopted.

| Official repository / code identity | License and maintenance observation | Proposed disposition / scope |
| --- | --- | --- |
| [Proj4js](https://github.com/proj4js/proj4js/tree/fe20fe65c426fa3c2f6530a399e9496b27a0390a) | [MIT text](https://github.com/proj4js/proj4js/blob/fe20fe65c426fa3c2f6530a399e9496b27a0390a/LICENSE.md); release v2.22.0, 2026-08-31; push 2026-09-13 | **Retain baseline** for coordinate transforms; record CRS/axis/unit/datum choices and offline grid requirements. Not a geometry solver. |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping/tree/82b0ac2c35304bfea9cac24eabcbda32a808ee55) | MIT; package 0.15.7; push 2024-04-19; latest GitHub release endpoint 404 | **Retain baseline** boolean geometry with regression evidence; slower release activity is a review input, not proof of abandonment. |
| [polyclip-ts](https://github.com/luizbarboza/polyclip-ts/tree/bef480bf8b035777d64a4ea857df109b5931aa61) | MIT; package 0.16.8; push 2025-11-09; latest release endpoint 404; declares BigNumber and splaytree-ts dependencies | **Retain baseline** where already used; compare both clipping engines on holes, tangency and near-degenerate inputs before consolidation. Neither validates an articulated mechanism. |
| [Shapely](https://github.com/shapely/shapely/tree/e044b139515d77c21730947a7e792281d2aa2619) | BSD-3-Clause; release 2.1.2, 2025-09-24; push 2026-09-23 | **Research companion** for independent planar GEOS geometry checks; Python/GEOS offline process, not React Native execution. |
| [pyproj](https://github.com/pyproj4/pyproj/tree/329a416233d76ebf901895c3dbf760ebfd00a07b) | MIT; release 3.8.0, 2026-09-05; push 2026-09-16 | **Research companion** transform oracle; pin PROJ data/grids, axis order and network policy. |
| [SciPy](https://github.com/scipy/scipy/tree/880593aa2d306b8f02fb37baf635f1781b50e5f3) | BSD-3-Clause; release v1.18.1, 2026-08-21; push 2026-09-27 | **Research companion** root solving/constrained numerical experiments; solver success does not establish global feasibility. |
| [JSTS](https://github.com/bjornharrtell/jsts/tree/34166d7e96f2b1f3a099a20c9408741a9a7cacec) | [Package license](https://github.com/bjornharrtell/jsts/blob/34166d7e96f2b1f3a099a20c9408741a9a7cacec/package.json) `EDL-1.0 OR EPL-1.0`; release 2.12.1, 2024-12-06; push 2025-01-02 | **Defer** additional topology engine until a demonstrated geometry gap justifies bundle/API/license review. |
| [RBush](https://github.com/mourner/rbush/tree/e59712716a84dda2e31f9b471b32faa178d8056f) | MIT; release v4.0.1, 2024-08-21; push 2026-09-03 | **Defer** until obstacle-search profiling shows need; bounding-box index only, requiring exact narrow-phase collision checks. |
| [OMPL](https://github.com/ompl/ompl/tree/5b209a03fe48c41f7a2f364382c2e425bf1c7c1c) | [BSD-3-Clause text](https://github.com/ompl/ompl/blob/5b209a03fe48c41f7a2f364382c2e425bf1c7c1c/LICENSE); release 2.0.2, 2026-08-14; push 2026-09-25 | **Defer** general motion planner; requires custom articulated state, constraints and collision model. C++/Python companion experiment only if justified. |
| [Fields2Cover](https://github.com/Fields2Cover/Fields2Cover/tree/93c0989ab2fc4a3f3d0a18bbd224d0e267a03fcc) | BSD-3-Clause; release v2.1.0, 2026-09-03; push 2026-09-22 | **Defer** agricultural coverage planner: mobile-vehicle swaths/routes do not supply pivot-anchored corner-arm mechanics. C++ companion integration is separate work. |

## Checks and evidence limits

- Passed: local selected-source SHA checks; PDF cover/revision/page inspection; stdlib XLSX structure/value inspection; CSV/JSON 75-record equality and all-No flag check; primary page/repository/license checks; public PDF direct retrieval and metadata extraction.
- Browser PDF retrieval failed and was replaced by successful direct retrieval. A first ad hoc reconciliation command had a syntax error; its corrected read-only command completed. No failed command is counted as evidence.
- Package execution, package installation, `npm run validate`, `npm audit`, browser proof and native/field checks were not run by this leaf. Aggregate tests/audit belong to the coordinator; source evidence alone cannot satisfy those gates.
- Remaining gaps: workbook authorship and semantic lineage; machine serial/as-built settings; angle conventions and rate limits; hydraulic calibration; qualified Lindsay/Reinke machine manuals; continuous articulated clearance and controller behavior; integration performance and dependency proof for any proposed companion.
- Integration/rollback: this file is additive research documentation. Removing it removes only the evidence summary; existing artifacts, catalogs, packages and product behavior are untouched by this leaf.
