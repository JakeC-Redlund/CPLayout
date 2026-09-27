# Receiver Protocol Support

Source review: 2026-09-17 UTC. This is an offline/source software increment, not a receiver, electrical or field qualification report. Owner targets remain PX1122R with ESP8266 communications, NS-RAW, Android first and later iOS. ESP8266 communications and ESP32 relay control are separate identities; see [hardware qualification](receiver-hardware-qualification.md).

## Implemented Boundaries

- `packages/gnss/src/receiverStream.ts` frames bytes per transport session before text decoding. A SkyTraq binary start or unsupported binary byte immediately closes browser collection until reconnect. Complete binary payloads are never searched for embedded NMEA. Malformed framing latches a fault. The decoder retains at most one 65,542-byte binary frame or a 1,024-character NMEA sentence.
- Partial text retains its first-byte reception timestamp. A frame taking more than 2,000 ms is discarded; this is a CPLayout collection policy, not a manufacturer latency specification. Invalid or regressing reception clocks fail closed. A new decoder is created for each session.
- `BrowserRtkReceiverPanel` admits only framed GGA/GST/RMC into the bounded collection window. Proprietary diagnostics cannot evict these samples or substitute for missing uncertainty, reference declarations or coherent epochs. Existing v2 capture validation remains authoritative.
- `px1122r.ts` parses the documented PSTI030 shape as diagnostics only. ENU velocities stay distinct from position uncertainty. Differential age and altitude retain explicit table-unit uncertainty; no conversion, correction-age fallback, century inference or precision guarantee is invented. Unknown or incomplete variants reject.
- `navsparkRaw.ts` decodes Venus DC measurement-time and DD raw-observation payloads after outer framing and checksum validation. It preserves availability flags, possible cycle slips, reserved bits and raw values. Unavailable values are not measurements; available nonfinite values reject and retain explicit diagnostic tokens. Known-layout length extensions reject; unknown message IDs remain opaque.

The NS-RAW decoder does not join epochs, infer a century/GPS rollover, convert receiver time to UTC, solve position or create survey evidence. `usable` on a raw measurement means only finite with its availability bit set. It is not solver acceptance or field qualification. The protocol family includes fields beyond the NS-RAW hardware's documented capabilities; decoding those fields does not expand device support.

## Offline Inspection

```sh
npm run --silent gnss:inspect -- --profile px1122r /absolute/path/receiver.nmea
npm run --silent gnss:inspect -- --profile ns-raw /absolute/path/receiver.bin
```

The command reads an explicitly selected regular file, up to 64 MiB, and prints JSON with the recording SHA-256, message counts, last decoded diagnostics and non-qualification boundaries. It rejects directories, symlinks, devices and pipes before reading. It does not open a receiver connection, send configuration/corrections, actuate relays, flash firmware or contact a service. Keep customer coordinates and original recordings outside Git.

Exit 0 means recognized diagnostic content was inspected, not that it is complete survey evidence. Exit 2 means rejected/unsupported input or a command/file error. The report separately identifies opaque message counts, malformed payloads, incomplete framing and unverified epoch coherence. File order supplies no reception clock, so offline inspection does not test freshness. NMEA following binary remains diagnostic-only, and trailing corruption cannot silently pass inspection.

The profile is an operator selection, not detected hardware identity. The PX1122R profile does not reinterpret Venus binary messages as Phoenix messages. NS-RAW mode does not run RTKLIB; a separately reviewed local solver/export integration is still needed. NavSpark's [FAQ](https://www.navspark.com.tw/faq) distinguishes raw binary mode from onboard PVT/PPS and describes host RTK processing.

## Source Evidence

Both PDFs were retrieved directly from the manufacturer during this pass. Hashes pin the reviewed content, not installed firmware or board revision.

| Source | Reviewed content | SHA-256 |
| --- | --- | --- |
| [PX1122R datasheet, p. 24](https://navspark.mybigcommerce.com/content/PX1122R_DS.pdf#page=24) | PSTI030 diagnostic fields, status/mode, velocity units and table ambiguities | `c49f5b8a7e0770caf3ef29ea100ab752aacf5cfb2d023f75b31a41e218ec404b` |
| [AN0030 v1.4.35, pp. 3-4, 41-44](https://navspark.mybigcommerce.com/content/AN0030_1.4.35.pdf#page=41) | SkyTraq frame structure, big-endian fields, payload XOR, DC/DD layouts and indicators | `4e637808831c7014eb7c4fd154bee61b2d503148a487fab95999ed705bbb468e` |

The DC table's printed TOW field numbering overlaps the week field. Its UINT32 width, ten-byte payload and example resolve TOW to payload offsets 4-7; the implementation records that discrepancy. No undocumented sentinel values or operational rate defaults are inferred.

## Acceptance and Remaining Work

Focused tests cover all chunk splits, binary-embedded valid NMEA, first-byte age, stale fragments, checksum/length failures, EOF truncation, reconnect boundaries, floating-point/flag cases and CLI behavior. The source and selected browser results for this candidate are recorded separately in [the execution record](full-refactor-execution.md); older evidence packets do not validate this build.

Still unverified: actual receiver firmware output and unsupported protocol variants; startup/hardware-buffer provenance across reconnect; NS-RAW epoch association and solver output; Android/iOS transports; ESP8266 assembly-specific netlist; relay/radio electrical routing; independent surveyed three-dimensional control errors. Neither a datasheet nor these tests establishes the owner's strictly less-than-0.10-m maximum 3D error requirement. No new dependency, firmware, hardware action or Git publication is part of this packet.

Visual review identified a wording defect in the capture gate: with no observation, a valid declaration also received a session-mismatch warning (`captureQualification.ts`). The subsequent copy/workflow continuation corrects this: no observation remains blocked without inventing a mismatch or qualifying a reference declaration. A real observed session mismatch and a missing declaration still reject collection. Three focused regressions and the binary-stream browser case cover the distinction. Final candidate acceptance is recorded in [the execution record](full-refactor-execution.md#independent-project-copy-continuation). Existing compact-navigation/footer ergonomics remain outside this protocol increment.
