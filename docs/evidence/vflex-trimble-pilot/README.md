# VFlex / Trimble pilot evidence and handoff

Recorded 2026-09-28; original packet captured during 2026-09-27 America/Denver. **Pilot incomplete:
`missing_evidence`.** The usable result is a local-source configuration record,
strict ingestion of the observed FLT review-export format, and a bounded file
search. No controller-file association, continuous VFlex trajectory, bench test
or field qualification is established.

The initial 16-file software delta passed aggregate and focused checks in a
separate captured source scope. Its unchanged historical
[validation receipt](validation.json) records 696 files and an unassessed offline
auditing attempt. The current 18-file integration and fresh online audit are
described below; canonical integration awaits the publication checkpoint.

The owner restricted this pass to information already available on this Windows
11 PC. Only local files support this packet. Raw customer exports, coordinates,
identities and proprietary manuals are not reproduced here. The private file
locator and recovery packet are retained outside the repository at
`/home/cyber/cplayout-vflex-pilot-9_as_xgs/`.

## Current isolated integration (2026-09-28)

The reviewed delta was reapplied against the clean publication source commit
`a70a6ebd81bcef1c11ca2fef6cdc57442f143689` in a new isolated checkout. Every
original handoff before/after hash was checked before application. The new
[validation receipt](integration-validation-20260928.json) records a fresh
aggregate pass with 601 unchanged source/test/configuration files, ten parser
tests, CLI/inventory checks, core typechecking and a fresh online `npm audit`
with zero reported vulnerabilities. Separate research checks passed: 42
TypeScript tests, 11 Python tests and isolated typechecking. Design-guide,
service-manual, skills, context-map and whitespace checks also passed. This source manifest deliberately excludes
documentation and reports and is not the original 696-file manifest. Original
validation receipts remain historical evidence. The publication checkout was
not changed, and canonical integration/publication remain pending.

A separately documented standalone GPS Mapping installation was checked through
its normal UI. Version 1.0.7.0 opened without a login prompt and exposed an empty
Add New Field form. Its configuration declares automatic GGS connection; a
file-only exchange was not established. No field was saved, no settings were
applied, and no controller interface was opened. The owned windows/process were
closed, with no FLT/GPSMap/GGSInterface process left. See the bounded
[runtime observation](standalone-runtime-20260928.json). The earlier FLT login
blocker and missing readable paired files are not resolved by this UI observation.

## Configuration and source identity

[pilot-configuration.json](pilot-configuration.json) records the requested
Valley VFlex / Trimble GGS family and the **owner-supplied nominal 205/82 ft**
dimensions. Null fields are missing evidence, not defaults. In particular,
machine identity, measured reference points, installation, operating directions,
sequencing, rover/base identities, firmware, correction source, datum, terrain
compensation and known-good backups remain unresolved.

One local KML design names `205 VFlex, 82 OH` and Standard installation, with an
850-ft LRDU-circle radius and partial sweep metadata. Its hash and other raw
settings are retained as a **candidate**, not adopted as the identified pilot.
It contains boundary, pivot, LRDU-circle and offset-line geometry; no separate
guidance trajectory or matching GGS was found beside it. Empty violation fields
and a `GuidancePathLength` value do not supply that missing geometry.

Keep three dimension sources distinct:

| Source | Local observation | Limit |
| --- | --- | --- |
| Owner plan | Nominal 205-ft span / 82-ft overhang | Not measured hinge, wheel, antenna or overhang references |
| VFlex guide 0998325, PDF p9 / printed 1-5 | 205 nominal; 204.9 actual span; 82.2 available overhang | Applicability and physical reference mapping still required |
| Installed FLT `GPSMapConfig.xml` | Model IDs 12/16/20, 205/82 labels, raw 201/86 lengths; speed variants | Do not select a variant or equate these fields with as-built measurements |

Primary sources already on this PC:

- FLT `Help.pdf`, SHA-256
  `b4785b3d4b0db98dc45ad80e714316d2dfd52cbdba5104478ba5cd4b61024f67`,
  installed under `C:\Program Files (x86)\Valmont\Valley FLT 4.4.4`.
  PDF pp23–27 document Layout GGS/Path/CSV export and GGS reimport with
  **Use Imported Guidance Path**. Design Export does not include GGS.
- `H:\GGS Dealer-2016A\GGS Manuals\Multi Freq. Corners\VFlex Corner Trimble Install 0999064_B.pdf`,
  SHA-256 `b8000fd6f5369ef3c871ebca6eeeeabb2e6b43f7878907b1b29740b27b5d7581`.
  PDF p48 documents GGS save and Interface opening; p53 documents Save Path and
  configuration/data backup; p58 documents replacement of the controller path.
  These are instructions, not evidence of execution on this machine.
- The installed standalone `ValleyGPSMapHelp.pdf` documents pivot length in
  feet, LRDU speed in ft/min, north-zero angles and clockwise partial-circle
  entry. Those UI conventions do not independently define the CSV columns.
- [Curated VFlex design guide](../../design-guides/guides/local-vflex-corner-0998325.md)
  identifies the local source and its SHA-256.

Installed FLT executable FileVersion/ProductVersion is `4.4.4.0`. No mapping
version has been established as compatible with this pilot's unidentified GGS
firmware. No controller generation is inferred from the Trimble name.

## Existing export inspection

[local-flt-review-inspection.json](local-flt-review-inspection.json) records
hash-bound, redacted inspection of three existing `Layout.csv`/`Layout.out`
pairs. All three contain the metadata label **Standard Pivot**; none is
established as the requested VFlex pilot. All CSV trajectory rows
say `No Violation`, but two OUT files explicitly report unsafe end-gun boundary
distance and require machine-length adjustment. A clean CSV row is insufficient.
Their OPT files name GGS output destinations whose files are absent. A filename
reference is not a controller artifact.

The implemented parser admits only the observed unquoted format: four-field
metadata record, exact 28-column header, ordered numeric rows, six labeled
summary records and optional end-gun events. Finite scientific notation occurs
in the original files. It rejects unknown formats instead of guessing headers,
units or reference points. Caller-supplied pairing remains unverified.

The API preserves the original numerical order and does not append a closing
point. Its `corner end X/Y` values remain **unqualified source numbers**. Units,
CRS, physical reference and interpolation are unresolved; these are never
imported into canonical projected/local XY. Equality of first/last source
coordinates after binary64 parsing is only an observation, not exact decimal
identity or full-cycle closure proof. Footprint and
acreage summaries are not recalculated or accepted as verified coverage.

Run the offline, read-only inspector from the repository root:

```sh
npm run inspect:flt-review -- /local/path/Layout.csv /local/path/Layout.out
```

It prints hashes, counts, sanitized diagnostics and unresolved interpretation;
it omits filenames, customer metadata, coordinate rows and raw OUT text. Exit
codes: `2` reported constraint violation, `3` missing/unresolved evidence, `1`
unreadable input, `64` invalid arguments. Only `--help` returns `0`: successful
inspection alone never reports a qualified trajectory. It does not open an app,
connect to a controller, write files or produce GGS.

## Local search and runtime observation

The bounded search covered installed FLT and Corner GPS Mapping directories,
`C:\Valmont\FLT\Data`, relevant cyber Desktop/Documents/Downloads/OneDrive
folders, the H: dealer packet and archived dealer ZIP, RTK and ClaRTK roots.
The D: parts tree had no matching GGS/Path/VFlex/Trimble filenames. F:, G: and the
H-reconnected mount had no visible files at their roots. Wider drive scans were
stopped after bounded runtime; system-protected folders and unrelated caches,
browser/credential stores and development dependency trees were excluded. This
is not an exhaustive inventory of every volume or archive.

OneDrive Documents contains `ggs.ggs` (23,257 bytes; modified
2023-04-24T00:10:00Z) and `path.kmz` metadata. Reading GGS bytes failed with
`EIO`; no SHA-256 or pairing can be established. Both files report Windows
attribute value `4199968`. The underlying cause was not diagnosed, and neither
cloud hydration nor repair was attempted. Their names/proximity do not prove
association. No GGS bytes were decoded. The archived dealer ZIP contains two
BPF examples and no GGS/Path/GPS members; its documented corner example is
185 Standard / 84 OH, not this nominal VFlex configuration.

No FLT process existed at preflight. The coordinator opened FLT PID 36308 and
observed `Valley Field Layout Tool ver 4.4.4` at its login screen using UI
Automation without reading credential values. The owner confirmed access was
unavailable. The owned window was closed; postflight found no FLT, GPSMap or
GGSInterface process. No project was created, no exchange ran, and no machine
was connected. Existing human browser questionnaires were left untouched.

## Remaining dependency gates

1. **OEM exchange:** obtain locally readable matching GGS and review exports,
   or execute the documented synthetic Layout export/reimport in the OEM app.
   Freeze source layout, options and output bytes; reimport that exact GGS with
   Use Imported Guidance Path. Explain units, datum, reference, ordering,
   closure, interpolation and rounding before tolerance-checking differences.
   No custom GGS serializer or inferred GGS schema is introduced.
2. **Production trajectory:** after that exit, implement versioned profile,
   request, result and handoff contracts; directed branch continuation and
   between-sample checks of the actual declared path. Do not certify supplied
   polyline tracking by substituting the research linear-angle interpolation.
   Wheel steering, VFlex dwell/timing, terrain and water remain separate.
3. **Shared integration:** use one result in maps/reports/layout evaluation;
   add field-design-v4 bindings and content-based staleness, legacy/archive
   round trips, then graph candidates through the same verifier. Reopened
   editor revision alone cannot prove freshness. These changes are not made
   by this evidence packet.
4. **Qualification:** retain predeclared tolerances, technician-controlled
   isolated-controller readback/restart/restore, calibration separate from at
   least two independently initialized validation traversals, reference-point
   measurements and uncertainty allowances. Bind acceptance to final GGS,
   machine configuration, base coordinates and operating envelope.

The original end-to-end objective remains open. Missing OEM evidence is not
infeasibility, and missing physical tests cannot be replaced by software tests.
No UI changes, native verification, Google Earth operation or controller
qualification are claimed. See the current
[integration receipt](integration-validation-20260928.json) and unchanged
[historical receipt](validation.json) for their distinct software scopes.
