import { nmeaChecksumValid } from "./nmea";

// PX1122R_DS.pdf p24, SHA-256 c49f5b8a7e0770caf3ef29ea100ab752aacf5cfb2d023f75b31a41e218ec404b.
export type Px1122rPsti030Mode = "A" | "D" | "E" | "F" | "M" | "N" | "P" | "R" | "S";

export interface Px1122rPsti030Diagnostic {
  sentenceType: "PSTI030";
  diagnosticOnly: true;
  utcTime: string;
  utcDateDdMmYy: string;
  dateCentury: "unspecified";
  status: "A" | "V";
  mode: Px1122rPsti030Mode;
  latitudeDegrees: number;
  longitudeDegrees: number;
  altitudeMeanSeaLevelRaw: number;
  altitudeUnit: "unspecified_in_psti030_table";
  velocityEnuMetersPerSecond: { east: number; north: number; up: number };
  differentialAgeRaw: number;
  differentialAgeUnit: "unspecified_in_psti030_table";
  rtkRatio: number;
}

/** Diagnostic only: no capture eligibility, uncertainty, datum transform or correction-age conversion. */
export function parsePx1122rPsti030(line: string): Px1122rPsti030Diagnostic | null {
  // Accept a framed sentence or its documented CRLF terminator, never trim arbitrary noise.
  const sentence = line.endsWith("\r\n") ? line.slice(0, -2) : line;
  if (!/^\$PSTI,030,[\x21-\x7e]+\*[0-9A-Fa-f]{2}$/.test(sentence) || !nmeaChecksumValid(sentence)) return null;
  const fields = sentence.slice(1, -3).split(",");
  if (fields.length !== 16 || fields[0] !== "PSTI" || fields[1] !== "030") return null;
  const [, , utcTime, status, latitude, northSouth, longitude, eastWest, altitude, east, north, up, date, mode, age, ratio] = fields;
  if (!validTime(utcTime) || !validDate(date) || (status !== "A" && status !== "V") || !isMode(mode)) return null;
  const latitudeDegrees = coordinate(latitude, northSouth, "latitude");
  const longitudeDegrees = coordinate(longitude, eastWest, "longitude");
  const altitudeRaw = decimal(altitude), eastVelocity = decimal(east), northVelocity = decimal(north), upVelocity = decimal(up);
  const differentialAgeRaw = decimal(age), rtkRatio = decimal(ratio);
  if (latitudeDegrees === null || longitudeDegrees === null || altitudeRaw === null || altitudeRaw < -9999.999 || altitudeRaw > 17999.999
    || eastVelocity === null || northVelocity === null || upVelocity === null
    || differentialAgeRaw === null || differentialAgeRaw < 0 || rtkRatio === null || rtkRatio < 0) return null;
  return {
    sentenceType: "PSTI030", diagnosticOnly: true, utcTime, utcDateDdMmYy: date, dateCentury: "unspecified", status, mode,
    latitudeDegrees, longitudeDegrees, altitudeMeanSeaLevelRaw: altitudeRaw, altitudeUnit: "unspecified_in_psti030_table",
    velocityEnuMetersPerSecond: { east: eastVelocity, north: northVelocity, up: upVelocity },
    differentialAgeRaw, differentialAgeUnit: "unspecified_in_psti030_table", rtkRatio,
  };
}

function decimal(value: string): number | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function coordinate(value: string, hemisphere: string, axis: "latitude" | "longitude"): number | null {
  // The p24 latitude example uses ddmm, while its format text says dddmm; admit both with leading zero.
  const pattern = axis === "latitude" ? /^(?:\d{4}|0\d{4})\.\d{7}$/ : /^\d{5}\.\d{7}$/;
  if (!pattern.test(value)) return null;
  if (axis === "latitude" ? hemisphere !== "N" && hemisphere !== "S" : hemisphere !== "E" && hemisphere !== "W") return null;
  const integerLength = value.indexOf(".");
  const degrees = Number(value.slice(0, integerLength - 2));
  const minutes = Number(value.slice(integerLength - 2));
  const maximum = axis === "latitude" ? 90 : 180;
  if (minutes >= 60 || degrees > maximum || (degrees === maximum && minutes !== 0)) return null;
  const result = degrees + minutes / 60;
  return hemisphere === "S" || hemisphere === "W" ? -result : result;
}

function validTime(value: string): boolean {
  // The table gives hundredths at its lower bound and milliseconds in its format/example.
  return /^\d{6}\.\d{2,3}$/.test(value) && Number(value.slice(0, 2)) <= 23
    && Number(value.slice(2, 4)) <= 59 && Number(value.slice(4)) < 60;
}

function validDate(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const day = Number(value.slice(0, 2)), month = Number(value.slice(2, 4)), year = Number(value.slice(4));
  // Keep the century unresolved. Year 00 may be leap, but no full Gregorian date is asserted.
  const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isMode(value: string): value is Px1122rPsti030Mode {
  return ["A", "D", "E", "F", "M", "N", "P", "R", "S"].includes(value);
}
