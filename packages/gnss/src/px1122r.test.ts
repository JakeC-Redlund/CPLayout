import assert from "node:assert/strict";
import test from "node:test";

import { nmeaChecksumValid } from "./nmea";
import { parsePx1122rPsti030 } from "./px1122r";

// Synthetic records use the field layout documented on PX1122R_DS.pdf p24; no receiver capture.
const fixture = ["PSTI", "030", "123456.789", "A", "3901.2500000", "N", "10430.7500000", "W",
  "1600.125", "1.25", "-2.50", "0.75", "170926", "R", "0.875", "4.125"];

function sentence(fields: readonly string[] = fixture): string {
  const body = fields.join(",");
  const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}`;
}

function replace(index: number, value: string): string {
  const fields = [...fixture]; fields[index] = value;
  return sentence(fields);
}

test("PSTI030 parses synthetic diagnostic fields with explicit unit and century limits", () => {
  const line = sentence();
  assert.equal(nmeaChecksumValid(line), true);
  const parsed = parsePx1122rPsti030(line);
  assert.deepEqual(parsed, {
    sentenceType: "PSTI030", diagnosticOnly: true, utcTime: "123456.789", utcDateDdMmYy: "170926", dateCentury: "unspecified",
    status: "A", mode: "R", latitudeDegrees: 39 + 1.25 / 60, longitudeDegrees: -(104 + 30.75 / 60),
    altitudeMeanSeaLevelRaw: 1600.125, altitudeUnit: "unspecified_in_psti030_table",
    velocityEnuMetersPerSecond: { east: 1.25, north: -2.5, up: 0.75 },
    differentialAgeRaw: 0.875, differentialAgeUnit: "unspecified_in_psti030_table", rtkRatio: 4.125,
  });
  assert.deepEqual(parsePx1122rPsti030(line + "\r\n"), parsed);
  assert.deepEqual(parsePx1122rPsti030(line.slice(0, -2) + line.slice(-2).toLowerCase()), parsed);
});

test("ENU values remain velocities, never position uncertainty or capture quality", () => {
  const parsed = parsePx1122rPsti030(sentence());
  assert.ok(parsed);
  for (const forbidden of ["quality", "rtk", "fixType", "captureEvidence", "horizontalAccuracyMeters", "verticalAccuracyMeters", "correctionAgeSeconds", "receiverObservedAt"]) {
    assert.equal(Object.hasOwn(parsed, forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(parsed.velocityEnuMetersPerSecond).sort(), ["east", "north", "up"]);
});

test("documented warning and all mode codes are retained without implying measured eligibility", () => {
  for (const status of ["A", "V"]) for (const mode of ["A", "D", "E", "F", "M", "N", "P", "R", "S"]) {
    const fields = [...fixture]; fields[3] = status; fields[13] = mode;
    const result = parsePx1122rPsti030(sentence(fields));
    assert.equal(result?.status, status);
    assert.equal(result?.mode, mode);
    assert.equal(result?.diagnosticOnly, true);
  }
  for (const unknown of ["", "X", "a", "v", "A ", " R", "1", "AA"]) {
    assert.equal(parsePx1122rPsti030(replace(3, unknown)), null);
    assert.equal(parsePx1122rPsti030(replace(13, unknown)), null);
  }
});

test("strict proprietary header, subtype and exactly fourteen data fields", () => {
  for (const header of ["GPSTI", "PSTIX", "psti", "PSTI ", "$PSTI", ""]) assert.equal(parsePx1122rPsti030(replace(0, header)), null);
  for (const subtype of ["30", "0030", "032", "030 ", "", "0x1e"]) assert.equal(parsePx1122rPsti030(replace(1, subtype)), null);
  assert.equal(parsePx1122rPsti030(sentence(fixture.slice(0, -1))), null);
  assert.equal(parsePx1122rPsti030(sentence([...fixture, ""])), null);
  assert.equal(parsePx1122rPsti030(sentence([...fixture, "extra"])), null);
  for (let index = 2; index < fixture.length; index += 1) assert.equal(parsePx1122rPsti030(replace(index, "")), null, `empty field ${index}`);
});

test("checksum corruption, line noise, controls and multiple frames are rejected", () => {
  const line = sentence();
  for (const invalid of [line.slice(0, -2) + (line.endsWith("00") ? "01" : "00"), line.slice(0, -3), line + "0",
    line.slice(0, -2) + "G0", line.slice(1), ` ${line}`, `${line} `, `${line}\n`, `${line}\r`, `${line}\r\n\r\n`,
    `${line}\r\n${line}`, `noise${line}`, replace(8, "1600\t"), replace(8, "1600\n"), replace(8, "1600\0"),
    replace(8, "1600\u007f"), replace(8, "1600\u00a0"), replace(8, "9".repeat(1100))]) {
    assert.equal(parsePx1122rPsti030(invalid), null, JSON.stringify(invalid));
  }
});

test("numeric fields reject nondecimal, nonfinite, whitespace and unknown sentinel syntax", () => {
  for (const index of [8, 9, 10, 11, 14, 15]) {
    for (const invalid of ["NaN", "Infinity", "-Infinity", "0x10", "1e2", "+1", ".1", "1.", " 1", "1 ", "--1", "unknown", "9".repeat(310)]) {
      assert.equal(parsePx1122rPsti030(replace(index, invalid)), null, `${index}: ${invalid}`);
    }
  }
  for (const index of [14, 15]) assert.equal(parsePx1122rPsti030(replace(index, "-1")), null);
  for (const index of [9, 10, 11]) assert.ok(parsePx1122rPsti030(replace(index, "-12.5")));
  assert.equal(parsePx1122rPsti030(replace(14, "0"))?.differentialAgeRaw, 0);
  assert.equal(parsePx1122rPsti030(replace(15, "0"))?.rtkRatio, 0);
});

test("documented mean-sea-level altitude endpoints are inclusive without inferred units", () => {
  for (const altitude of ["-9999.999", "17999.999", "0", "-1.125"]) {
    assert.equal(parsePx1122rPsti030(replace(8, altitude))?.altitudeMeanSeaLevelRaw, Number(altitude));
  }
  for (const altitude of ["-10000", "18000", "17999.9991", "-9999.9991"]) assert.equal(parsePx1122rPsti030(replace(8, altitude)), null);
});

test("coordinates enforce axis hemispheres, minute ranges and geographic endpoints", () => {
  for (const [index, invalids] of [
    [4, ["3901", "3901.25", "3901.25000000", "9010.0000000", "9000.0000001", "9100.0000000", "3960.0000000", "-3901.2500000", "13901.2500000"]],
    [6, ["10430", "10430.75", "18000.0000001", "18100.0000000", "10460.0000000", "0430.7500000", "+10430.7500000"]],
    [5, ["E", "W", "n", "s", "X", ""]], [7, ["N", "S", "e", "w", "X", ""]],
  ] as const) for (const invalid of invalids) assert.equal(parsePx1122rPsti030(replace(index, invalid)), null, `${index}: ${invalid}`);
  assert.equal(parsePx1122rPsti030(replace(4, "03901.2500000"))?.latitudeDegrees, 39 + 1.25 / 60);
  const fields = [...fixture]; fields[4] = "9000.0000000"; fields[5] = "S"; fields[6] = "18000.0000000"; fields[7] = "E";
  assert.equal(parsePx1122rPsti030(sentence(fields))?.latitudeDegrees, -90);
  assert.equal(parsePx1122rPsti030(sentence(fields))?.longitudeDegrees, 180);
});

test("UTC time bounds and declared fractional precision cannot silently truncate", () => {
  for (const time of ["000000.00", "000000.000", "235959.999"]) assert.equal(parsePx1122rPsti030(replace(2, time))?.utcTime, time);
  for (const time of ["240000.000", "236000.000", "235960.000", "123456", "123456.7", "123456.7890", "12345.678", "-123456.789", "123456.78 "]) {
    assert.equal(parsePx1122rPsti030(replace(2, time)), null, time);
  }
});

test("two-digit UTC date validates calendar components but never invents a century", () => {
  for (const date of ["290224", "290200", "010180", "311299", "010100"]) {
    const result = parsePx1122rPsti030(replace(12, date));
    assert.equal(result?.utcDateDdMmYy, date);
    assert.equal(result?.dateCentury, "unspecified");
  }
  for (const date of ["290223", "310426", "310226", "000126", "320126", "011326", "010026", "17092026", "17092", "170926 "]) {
    assert.equal(parsePx1122rPsti030(replace(12, date)), null, date);
  }
});
