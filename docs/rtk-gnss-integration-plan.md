# RTK/GNSS Hardware Integration Plan

Last reviewed: 2026-09-13
Status: active top-priority implementation and field-proof plan

## Owner-Confirmed Targets: 2026-09-13

The owner selected NavSpark PX1122R and NavSpark NS-RAW, Android phones/tablets first, and compatible iOS devices later. Required maximum position error is **strictly less than 0.10 m in 3D, including elevation**. This is a measured XYZ control-error requirement, not horizontal-only error, horizontal RMS, receiver precision, GST uncertainty or a manufacturer accuracy guarantee.

The owner requires software-selectable USB, Bluetooth and local Wi-Fi links and confirmed a PX1122R evaluation board with an ESP32-controlled four-channel relay board for jumper routing. Exact evaluation-board revision, jumper functions, relay-board SKU, channel-to-jumper mapping, relay polarity, ESP32 firmware/control protocol, power and electrical constraints remain unconfirmed. No relay command, pin assignment, native transport or physical accuracy is verified by this plan.

Three-dimensional field acceptance requires independently established horizontal and vertical controls, finite measured/reference heights, and matching explicit height type, vertical datum and physical reference point. Calculate each error as `hypot(dx, dy, dz)` in a common orthonormal local ENU or geocentric ECEF frame, not uncorrected projected grid XY plus height. Require the maximum to be below 0.10 m; equality fails. Retain horizontal, vertical and 3D RMS/max separately. Unknown frame realization/epoch, transformation, geoid model, antenna offset or height provenance blocks physical acceptance. A 2D-only packet cannot qualify. Canonical project editing geometry remains projected/local XY; comparison coordinates and heights are evidence, not an implicit project-schema or vertical-transformation migration.

Evaluate every capture-eligible epoch in the declared control occupations, including failures, rather than selecting the best fixes. Control uncertainty, receiver/antenna offsets, pole height/tilt, transformation uncertainty and time alignment need a documented error budget. Begin with stationary occupations; motion requires a synchronized reference trajectory and lever-arm treatment. A measured pass describes those tested conditions only, not a guaranteed future maximum.

### Manufacturer Review: 2026-09-13

| Target | Source-backed capability | Implementation and proof boundary |
| --- | --- | --- |
| PX1122R | Dual-band, multi-constellation onboard RTK base/rover; documented NMEA solution and RTCM interfaces. | First solved-position commissioning candidate, not proof of the owner's strict 3D maximum. Record the actual firmware and enabled messages. |
| NS-RAW | GPS L1 raw-measurement sensor; binary raw mode does not compute a PVT solution. NavSpark describes a host RTKLIB workflow. | Separate raw decoder and pinned local RTK engine/companion path. It must not inherit PX1122R protocol or onboard-RTK assumptions. |
| PX1122R evaluation board | Published EVB guide distinguishes USB solution/configuration and correction paths, with separate correction and command routing groups; Bluetooth SPP is documented. | Match the owner's exact revision to the schematic before assigning relay channels. The guide does not prove a local Wi-Fi bridge or that four relay channels can safely implement every requested route. |
| Android and later iOS | Android USB host requires device support and permission. BLE uses documented GATT; generic Classic SPP cannot be assumed on iOS. | Separate USB, SPP, BLE and local-network adapters and device reports. No universal phone/tablet compatibility claim. |

Sources: [PX1122R datasheet](https://navspark.mybigcommerce.com/content/PX1122R_DS.pdf), [NavSpark FAQ](https://www.navspark.com.tw/faq), [NS-RAW tutorial](https://www.navspark.com.tw/tutorial-4), [EVB guide](https://navspark.mybigcommerce.com/content/Getting_Started_with_PX1122-RTK-EVB.pdf), [EVB schematic](https://navspark.mybigcommerce.com/content/PX1122-RTK%20EVB-SWID-V0_3-ENG-20210324.pdf), [Android USB host](https://developer.android.com/develop/connectivity/usb/host), [Apple Bluetooth accessory guidance](https://developer.apple.com/library/archive/qa/qa1657/_index.html), and [RTKLIB upstream](https://github.com/tomojitakasu/RTKLIB). These documents describe product families, not an inspection of the owner's hardware.

The PX1122R datasheet's fixed GGA example leaves correction age blank, and its documented sentence list does not establish GST output. PSTI030 documents RTK age/ambiguity information; [Phoenix protocol AN0037](https://navspark.mybigcommerce.com/content/AN0037.pdf) has GST configuration commands, but command documentation is not observed firmware output. The current generic NMEA gate requires matching uncertainty and correction-age evidence, so it may correctly reject this receiver until a manufacturer-specific adapter is implemented and replay/device tested. Do not relax the gate or substitute HDOP for metre accuracy to make a receiver appear supported. GGA/PSTI height labels alone do not establish a named vertical datum, geoid model or antenna reference point.

The current capture gate is **not 3D-qualified**: it does not require an acceptable vertical uncertainty or verified antenna/height reference at capture time. The next receiver-profile packet must add explicit vertical/session metadata and fail-closed 3D eligibility tests before any field-ready 3D capture claim. Do not rewrite earlier observations or equate a report-validator pass with physical accuracy.

### Transport Switching Boundary

Implement the selector only through a tested transport/relay coordinator, not independent UI toggles. Planned ownership is `packages/gnss/src/transportSwitchController.ts` for pure state transitions, platform adapters under `apps/mobile/src/gnss/`, and a separately specified relay-control adapter outside domain geometry. Receiver capabilities belong in a source-backed profile, not guessed from a device name.

1. Close the capture gate synchronously, invalidate the current observation and serialize the switch request. Pending captured drafts keep their original source/session evidence and must not acquire the new session's quality.
2. Stop/drain correction writes and close the old data transport. A cleanup failure retains ownership and blocks another connection; explicit retry or operator recovery is required.
3. Request the verified relay routing through its documented control channel. Break-before-make timing, deenergized state, power sequencing and allowable simultaneous routes must come from the schematic/controller contract. Never infer that shorting or opening an unknown jumper is safe.
4. Require acknowledged/read-back routing and settling, then open exactly one selected data adapter. A firmware acknowledgement is not physical relay-contact readback; record which evidence the actual controller provides. The control channel must remain recoverable when the selected GNSS data path is unavailable; loss of the only control channel is a design blocker. Specify authenticated local commands, idempotent request identifiers, state queries and restart/watchdog behavior before implementing the ESP32 adapter. Do not assume GPIO polarity, HTTP, MQTT or a cloud service.
5. Start a new receiver session and require fresh coherent data, confirmed frames/heights and applicable quality gates before capture. Old buffered epochs, failed relay acknowledgements, timeouts and partial reconnects keep capture blocked.

Pure fake-clock/transport/relay tests must cover every transition, overlapping requests, disconnect and cleanup failures, acknowledgement loss, stale data and no unintended geometry writes. Android device proof must then cover all three actual links and the physical relay routing, including attach/detach, app background/resume, interruption, restart and recovery. Bluetooth SPP versus BLE, Wi-Fi TCP/UDP framing, endpoint discovery, correction routing and iOS accessory authorization remain device-specific decisions. No paid service, cloud control, hidden key or proprietary trial SDK is authorized.

The current implementation provides desktop browser serial commissioning and synthetic lifecycle checks only. This owner-confirmed scope guides the next native/hardware packet; it does not enable unimplemented Android/iOS links or relay controls in the UI.

## Reliability Review: 2026-09-13

The earlier source/browser checkpoint below is historical, not a blanket correctness claim. The active [mapping and RTK quality program](mapping-rtk-quality-program.md) has reproduced and corrected capture-gate and parsing failures with focused regression tests. The current receiver path rejects malformed/latest-invalid GGA, invalid numeric quality/configuration/timing, incomplete matching RMC, and stale sentence joins. It uses both GST horizontal components for estimated RMS and retains the first receipt time of repeated epochs. Capture handlers recheck the gate at command time.

The new horizontal estimate is explicitly RMS, not a 95% confidence radius or measured field error. No saved observations are rewritten. Browser, aggregate, serial lifecycle and physical receiver acceptance are separate gates; consult the program's current packet status before treating this implementation as accepted.

## Decision

CPLayout will use a transport-neutral TypeScript GNSS pipeline and keep projected/local `XY` as canonical project geometry. Desktop Chromium Web Serial is the first commissioning surface. Android USB host is the first native target. BLE, Android Bluetooth Classic SPP, and iOS accessory transports remain separate adapters behind the same byte-stream contract. Receiver-managed corrections come first; an in-app NTRIP client is a later, credential-isolated lane.

This plan selects no paid correction service. The owner-selected receivers above take precedence over earlier reference-fixture candidates. A solved-position receiver path needs documented solution/quality output and correction support; a raw-measurement receiver requires a separately verified RTK engine/companion path before it can supply qualifying positions. The operator may bring independently obtained hardware and correction access while CPLayout remains free/no-cost and offline-first.

## Verified Checkpoint

Implemented in the 2026-08-09 pass:

- `packages/gnss/src/transport.ts` defines timestamped byte, error, disconnect, close, and correction-write contracts.
- `packages/gnss/src/nmea.ts` rejects bad or missing checksums, validates coordinates, correlates GGA/GST/RMC by UTC epoch, rejects incoherent or void epochs, stamps monotonic reception time, advances observation/correction age, and fails closed on disconnect, stale data, low quality, or unconfirmed source CRS.
- GGA code `4` maps to RTK fixed and `5` to RTK float. Code `6` remains `unknown`; vendor-specific semantics require a receiver-specific source.
- `gnss-capture-v1` provenance is stored on survey points and ordered boundary, obstacle, and map-feature vertices. Project validation and ZIP round trips preserve it and enforce vertex/evidence alignment.
- Reducer transactions preserve captured observations as evidence. Moving infrastructure does not rewrite its source observation; referenced observations cannot be deleted; captured coordinates and provenance cannot be silently edited.
- `apps/mobile/src/gnss/webSerialTransport.ts` implements desktop Web Serial with permission-bound open, a single event consumer, full-duplex writes, EOF/disconnect handling, and idempotent close.
- The browser receiver panel requires explicit `EPSG:4326`, uses a monotonic stale-data timer, blocks capture after EOF/error/disconnect, retains rejected drafts, and clears drafts only after a successful reducer transaction.
- Settings expose fix, satellite, HDOP, horizontal-accuracy, correction-age, and observation-age gates. Defaults are RTK fixed, 12 satellites, HDOP 1.2, 0.05 m horizontal accuracy, 3 s correction age, and 2 s observation age. These are configurable defaults, not a certified survey specification.
- `tools/roadmapCompletion.ts` validates a hashed `cplayout-gnss-runtime-proof-v1` report and blocks release when current-commit hardware proof is missing.

Unverified:

- No physical receiver or RTCM/NTRIP stream was exercised in this pass.
- Android USB/Bluetooth, iOS BLE/MFi, antenna phase-center offsets, pole tilt, coordinate epoch, vertical datum, multipath, and field accuracy remain unproved.
- Browser Web Serial is not a native mobile transport claim.

## Data Flow

1. The receiver produces NMEA solutions and normally manages corrections initially. Future CPLayout-delivered RTCM bytes remain opaque and never become project geometry.
2. A Web Serial, Android USB, BLE, SPP, MFi, local TCP, or replay adapter emits timestamped bytes and terminal errors/disconnects.
3. A strict GGA-anchored epoch assembler accepts GST/RMC only at matching UTC. Monotonic reception time, not receiver wall-clock time, controls staleness.
4. Connection, coherence, age, source CRS, fix type, satellite count, HDOP, accuracy, and correction age must all pass.
5. Accepted WGS84 coordinates are projected into the project CRS. WGS84 remains input/display evidence; projected/local `XY` is canonical.
6. An explicit operator capture invokes a core reducer transaction. Failed writes keep their draft and error.
7. Project JSON, repositories, and ZIPs preserve capture evidence. Credentials, raw RTCM, and machine paths never enter project exports.

## Hardware Contract

Before a receiver/device combination enters the supported matrix, it must provide:

- documented GGA output with fixed/float semantics and GST or another documented accuracy source;
- a correction-age indicator or source-backed equivalent, otherwise the gate remains closed;
- deterministic disconnect detection and bidirectional I/O when CPLayout supplies corrections;
- manufacturer, model, firmware, antenna model, antenna reference point, height, and reference-frame configuration in its field report;
- no trial-only SDK, paid app runtime, hidden key, required cloud backend, or vendor telemetry dependency.

The earlier u-blox ZED-F9P reference-fixture candidate is not the selected first hardware target. PX1122R and NS-RAW now require their own manufacturer-backed capability and fixture review; neither inherits another receiver's GGA, GST, RTCM, height or transport assumptions. Each actual receiver/board/firmware/platform combination must pass before entering the supported matrix.

## Execution Phases

### Phase 1: Desktop Commissioning

- Connect one documented dual-band receiver through desktop Chromium Web Serial.
- Capture sanitized replay fixtures for fixed, float, autonomous, stale correction, bad checksum, inconsistent UTC, and disconnect cases.
- Exercise full-duplex writes only through a credential-safe test or receiver-managed bridge.
- Produce a `cplayout-gnss-runtime-proof-v1` report with at least two independently known control points and hashed observation/control evidence.
- Require fixed/float agreement with the receiver UI/log and fail-closed behavior for disconnect, stale data, void RMC, checksum failure, and unknown source CRS.

### Phase 2: Android USB Host

- Create a local Expo module outside `packages/gnss`; keep that package platform-neutral.
- Follow Android USB host permission, attach/detach, endpoint, and background-thread rules.
- Evaluate `usb-serial-for-android` as the leading MIT-licensed CDC/ACM, FTDI, CP210x, PL2303, and CH34x driver candidate. Pin it only after maintenance, license, supported-chip, Expo SDK 55/New Architecture, and target-device spikes pass.
- Add an Expo config plugin with narrowly scoped USB device filters, then rebuild the local development client.
- Device-prove attach, denial, read/write, physical detach, background/foreground, rotation, reconnect, and exactly one terminal disconnect event.

Expected phase-owned files:

- `apps/mobile/modules/cplayout-gnss-transport/`
- `apps/mobile/plugins/withCplayoutGnssTransport.ts`
- `apps/mobile/src/gnss/androidUsbTransport.native.ts`
- receiver fixtures and report tooling under `tools/`

### Phase 3: Corrections

- Keep receiver-managed NTRIP as the default mode.
- Add an in-app client only after a threat model and local secret-storage design pass review.
- Keep username/password outside project JSON, SQLite project rows, ZIP/KML/KMZ, logs, reports, and agent memory.
- Persist only non-secret caster status locally; record only byte counts, age, state, source label, and sanitized errors.
- Require explicit connect/stop controls and no external connection merely because a project opens.
- Test TLS behavior, authentication failure, mountpoint rejection, loss, stale corrections, backpressure, and redaction while preserving fully offline project use.

### Phase 4: Field Proof

Each receiver/platform pair needs repeated occupations and a report containing:

- at least two known controls, finite measured/reference heights in matching frames, and independently recomputed horizontal, vertical and 3D RMS/max error; the maximum 3D error must be strictly below 0.10 m;
- maximum observation/correction age and fixed/total samples;
- antenna model, ARP, height, phase-center status, pole/tilt method, reference frame, coordinate epoch, project CRS, and height type;
- session times, reconnect and fail-closed results, exact app/receiver versions, current commit, and SHA-256 evidence.

`npm run verify:release -- --gnss-report <report.json>` must validate this packet on a clean tree. Tests, compilation, replay data, or a connected icon are not field proof.

Start each packet from `docs/gnss-runtime-verification-report-template.json`. Leave `status` incomplete until every required observation and evidence field is populated from the actual session.

The strengthened [derived evidence contract](gnss-derived-evidence-contract.md) validates finite heights, matching vertical/frame metadata, two distinct hashed artifacts and recomputed statistics from separate declared orthonormal ENU coordinates. Exact 0.10 m fails. This is artifact consistency only: current physical/release validation has no success path until comparison-frame derivation is independently verifiable and its verifier is implemented and reviewed. Matching a host Git commit also cannot prove the identity of an installed native build. Do not turn either blocker into a self-attested boolean or mark a synthetic report as field proof.

### Phase 5: iOS and Other Transports

- BLE needs a receiver-documented GATT service and notification/write/reconnect proof.
- Classic Bluetooth serial cannot be assumed on iOS. External Accessory requires a manufacturer-authorized MFi protocol; use it only after authorization and device proof.
- Android SPP and BLE are separate adapters with separate permission/background/reconnect tests.
- Local TCP is permitted only for an operator-controlled local bridge with no hidden cloud dependency.

## Release Profiles

- `npm run verify:roadmap:fast`: development checks; skipped gates make the result incomplete.
- `npm run verify:roadmap`: checkpoint profile with browser proof; dirty/historical evidence remains a snapshot, not release evidence.
- `npm run verify:release`: clean-tree, current-commit evidence profile. Missing hardware evidence is blocked, not synthesized.
- `--dry-run`: describes gates without writing report files.

## Dependencies and Upgrades

- Current target: Expo SDK 55, React Native 0.83, React 19.2, React Native Web 0.21, Node 24 LTS, and npm 11. `npx expo install --check` passed on 2026-08-09. Expo Doctor passed 18 of 19 checks; its sole exception is the existing native-folder/app-config synchronization warning, which remains an explicit build-process gap.
- Use `npx expo install` for Expo packages. Do not combine an SDK-major upgrade with the first native GNSS module.
- Quarterly: run `npm outdated`, Expo package/doctor checks, `npm audit`, `npm run validate`, and `npm run proof:web`; rebuild native projects and repeat device reports after native-code changes.
- Do not apply unbounded forced audit remediation. Review each advisory path and breaking upgrade separately.
- Use `docs/dependency-upgrade-plan.md` as the direct-package inventory and upgrade decision record.
- RTKLIB remains an offline companion/reference candidate. React Native does not directly run RTKLIB, Python, or GDAL workflows.

## Validation

| Change | Required gate |
| --- | --- |
| NMEA, epoch, quality, projection | GNSS/core tests and `npm run validate` |
| Browser serial/UI | mobile tests and `npm run proof:web` |
| Evidence schema/archive | project document and archive round-trip tests |
| Native transport | rebuilt development client and attach/read/write/detach device report |
| Corrections | redaction/network/backpressure tests plus receiver proof |
| Plan/routing/source record | context-map check, skill validation, diff check, audit |
| Release claim | clean-tree `npm run verify:release` with current hashed reports |

## Non-Goals

- No automatic pivot relocation or mutation of captured observation coordinates.
- No canonical WGS84 geometry or credentials/raw corrections in exports.
- No certified land-survey, machine-control, safety-system, controller-write, autosteer, or VRI claim.
- No compatibility claim from documentation or replay data alone.

## Primary Sources Checked 2026-08-09

- Expo SDK 55 matrix: https://docs.expo.dev/versions/v55.0.0/
- Expo native development-build boundary: https://docs.expo.dev/develop/development-builds/introduction/
- Chrome Web Serial: https://developer.chrome.com/docs/capabilities/serial
- Android USB host: https://developer.android.com/develop/connectivity/usb/host
- Apple External Accessory: https://developer.apple.com/documentation/externalaccessory/
- Apple BLE/MFi clarification: https://developer.apple.com/library/archive/qa/qa1657/_index.html
- u-blox ZED-F9P integration manual: https://content.u-blox.com/sites/default/files/ZED-F9P_IntegrationManual_UBX-18010802.pdf
- NOAA antenna calibration and ARP guidance: https://www.ngs.noaa.gov/research/gnss-satellite/gnss-antenna-calibration.shtml
- NOAA OPUS antenna/reference-frame guidance: https://www.ngs.noaa.gov/OPUS/about.jsp
- IGS RTCM/NTRIP access: https://igs.org/rts/formats/ and https://www.igs.org/rts/user-access/
- RTKLIB upstream: https://github.com/tomojitakasu/RTKLIB
- Android USB serial candidate: https://github.com/mik3y/usb-serial-for-android
- Node release status: https://nodejs.org/en/about/previous-releases
