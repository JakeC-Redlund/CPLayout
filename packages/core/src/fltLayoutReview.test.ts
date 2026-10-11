import assert from "node:assert/strict";
import test from "node:test";
import { FLT_LAYOUT_HEADERS, FLT_LAYOUT_FOOTER_LABELS, FLT_LAYOUT_UNSAFE_OUT, parseFltLayoutReview } from "./fltLayoutReview";

const identity = "SYNTHETIC-PRIVATE-FIELD";
const directory = "C:\\synthetic-private-output";
function lines(count = 3): string[] {
  return [`${identity},Standard Pivot,15,${directory}`, FLT_LAYOUT_HEADERS.join(","),
    ...Array.from({ length: count }, (_, index) => [index, ...Array.from({ length: 26 }, (_, column) => index * 10 + column + 0.25), "No Violation"].join(",")),
    ...FLT_LAYOUT_FOOTER_LABELS.map((label, index) => `${label},${index + 1}.25`),
    "Endgun 0 Start: 17.76623 Degrees Endgun 0 End: 70.12987 Degrees", ""];
}
const csv = (count = 3): string => lines(count).join("\r\n");
function changedCell(row: number, column: number, value: string): string {
  const source = lines(), cells = source[row].split(","); cells[column] = value; source[row] = cells.join(","); return source.join("\n");
}

test("385-row observed shape retains numeric order and exact footer labels without exposing metadata", () => {
  const result = parseFltLayoutReview(csv(385), " Path Successful\r\n");
  assert.equal(result.csvStatus, "parsed_observed_format");
  assert.equal(result.outStatus, "reported_path_successful");
  assert.equal(result.status, "numerically_unresolved");
  assert.deepEqual(result.rows.map(row => row.values.index), Array.from({ length: 385 }, (_, index) => index));
  assert.equal(result.rows[384].values["corner end X"], 3843.25);
  assert.equal(result.rows[384].values["corner end Y"], 3844.25);
  assert.deepEqual(result.footers, FLT_LAYOUT_FOOTER_LABELS.map((label, index) => ({ label, value: index + 1.25 })));
  assert.deepEqual(result.endgunEvents, [{ index: 0, startDegrees: 17.76623, endDegrees: 70.12987 }]);
  assert.deepEqual(result.summary, { rowCount: 385, footerCount: 6, endgunEventCount: 1, qualifiedTrajectory: false });
  for (const privateText of [identity, directory]) assert.equal(JSON.stringify(result).includes(privateText), false);
});

test("OUT unsafe wins over every No Violation CSV row, including wrapped warning text", () => {
  const result = parseFltLayoutReview(csv(), FLT_LAYOUT_UNSAFE_OUT.replace("machine. ", "machine.\r\n "));
  assert.equal(result.csvStatus, "parsed_observed_format");
  assert.equal(result.status, "constraint_violated");
  assert.equal(result.outStatus, "reported_unsafe");
  assert.equal(result.rows.every(row => row.violation === "No Violation"), true);
  assert.equal(parseFltLayoutReview("malformed", FLT_LAYOUT_UNSAFE_OUT).status, "constraint_violated");
});

test("missing and unknown OUT evidence cannot become a pass or leak raw OUT text", () => {
  for (const out of [undefined, null, 17, "", " \r\n"]) {
    assert.equal(parseFltLayoutReview(csv(), out).status, "missing_evidence");
  }
  for (const out of ["Private unknown failure", "Path Successful\nAdditional warning", "Path\nSuccessful"]) {
    const result = parseFltLayoutReview(csv(), out);
    assert.equal(result.status, "numerically_unresolved");
    assert.equal(result.outStatus, "unrecognized");
    assert.equal(JSON.stringify(result).includes(out), false);
  }
});

test("open and explicitly repeated endpoints are observations only; no closure or units inferred", () => {
  const open = parseFltLayoutReview(csv(), "Path Successful");
  assert.equal(open.closure.firstLastCornerEnd, "different");
  assert.equal(open.rows.length, 3);
  const source = lines(), first = source[2].split(","), last = source[4].split(",");
  last[4] = first[4]; last[5] = first[5]; source[4] = last.join(",");
  const closed = parseFltLayoutReview(source.join("\n"), "Path Successful");
  assert.equal(closed.closure.firstLastCornerEnd, "equal");
  assert.equal(closed.rows.length, 3);
  for (const result of [open, closed, parseFltLayoutReview(csv(1), "Path Successful")]) {
    assert.equal(result.closure.appendedClosingRow, false);
    assert.equal(result.closure.cycleQualification, "unresolved");
    assert.deepEqual(result.coordinates, { sourceColumns: ["corner end X", "corner end Y"], numericRepresentation: "binary64", units: "unresolved",
      referencePoint: "unresolved", crs: "unresolved", interpolation: "unresolved", canonicalGeometryImported: false });
    assert.equal(result.status, "numerically_unresolved");
  }
});

test("malformed numeric fields and nonmonotonic or duplicate indices reject the whole CSV", () => {
  for (const value of ["", " ", "NaN", "Infinity", "-Infinity", "1x", "0x10", "1e999", "1e", "1e+", "9".repeat(400)]) {
    for (const column of [0, 4, 5, 26]) {
      const result = parseFltLayoutReview(changedCell(3, column, value), "Path Successful");
      assert.equal(result.csvStatus, "missing_evidence", `${column}: ${value}`);
      assert.deepEqual(result.rows, []);
    }
  }
  for (const index of ["0", "-1", "1.5", "9007199254740992"]) {
    assert.equal(parseFltLayoutReview(changedCell(3, 0, index), "Path Successful").csvStatus, "missing_evidence");
  }
  assert.equal(parseFltLayoutReview(changedCell(4, 0, "1"), "Path Successful").csvStatus, "missing_evidence");
});

test("observed scientific-notation corner-end coordinates retain finite numeric values without qualification", () => {
  for (const [source, expected] of [["1.25e-12", 1.25e-12], ["-2.5E+3", -2500], ["+.5e2", 50]] as const) {
    const result = parseFltLayoutReview(changedCell(2, 4, source), "Path Successful");
    assert.equal(result.csvStatus, "parsed_observed_format");
    assert.equal(result.rows[0].values["corner end X"], expected);
    assert.equal(result.rows.length, 3);
    assert.equal(result.status, "numerically_unresolved");
    assert.equal(result.coordinates.units, "unresolved");
    assert.equal(result.coordinates.canonicalGeometryImported, false);
  }
});

test("nonzero mantissa underflow cannot fabricate equal corner-end coordinates", () => {
  const source = lines(), first = source[2].split(","), last = source[4].split(",");
  first[4] = "1e-999"; last[4] = "2e-999"; first[5] = last[5] = "0";
  source[2] = first.join(","); source[4] = last.join(",");
  const result = parseFltLayoutReview(source.join("\r\n"), "Path Successful");
  assert.equal(result.csvStatus, "missing_evidence");
  assert.equal(result.status, "missing_evidence");
  assert.deepEqual(result.rows, []);
  assert.equal(result.closure.firstLastCornerEnd, "insufficient_rows");
  assert.equal(result.coordinates.numericRepresentation, "binary64");
  for (const value of ["-1e-999", "+.2e-999", "1e-324"]) {
    assert.equal(parseFltLayoutReview(changedCell(2, 4, value), "Path Successful").csvStatus, "missing_evidence");
  }
  for (const value of ["0e-999", "-0.0e-999", "5e-324"]) {
    assert.equal(parseFltLayoutReview(changedCell(2, 4, value), "Path Successful").csvStatus, "parsed_observed_format");
  }
});

test("unknown headers, widths, statuses, quoting, and extra sections are rejected", () => {
  const variants: string[][] = [];
  for (const [index, replacement] of [[1, FLT_LAYOUT_HEADERS.join(",").replace("Violation ", "Violation")],
    [2, lines()[2] + ",extra"], [2, lines()[2].split(",").slice(1).join(",")],
    [2, lines()[2].replace("No Violation", "Unknown")], [0, `\"${identity}\",Standard Pivot,15,${directory}`],
    [0, `${identity},Other Machine,15,${directory}`], [3, ""]] as const) {
    const source = lines(); source[index] = replacement; variants.push(source);
  }
  variants.push([...lines().slice(0, -1), "unexpected section", ""]);
  for (const source of variants) {
    const result = parseFltLayoutReview(source.join("\r\n"), "Path Successful");
    assert.equal(result.status, "missing_evidence");
    assert.deepEqual(result.rows, []);
    assert.equal(JSON.stringify(result).includes(identity), false);
  }
  for (const value of [null, undefined, 12, {}, ""]) assert.equal(parseFltLayoutReview(value, "Path Successful").csvStatus, "missing_evidence");
});

test("six footers are mandatory and ordered; zero or multiple distinct endgun events supported", () => {
  const noEvents = lines().slice(0, -2).join("\n");
  assert.equal(parseFltLayoutReview(noEvents, "Path Successful").csvStatus, "parsed_observed_format");
  const multiple = [...lines().slice(0, -1), "Endgun 1 Start: -2.5 Degrees Endgun 1 End: 360 Degrees"].join("\n");
  assert.equal(parseFltLayoutReview(multiple, "Path Successful").endgunEvents.length, 2);
  const variants = [
    noEvents.replace("pivot acres,2.25\n", ""), noEvents.replace("pivot acres", "corner acres"),
    noEvents.replace("total acres,4.25", "total acres,"), noEvents.replace("total acres,4.25", "total acres,4.25,extra"),
    csv().replace("Endgun 0 End:", "Endgun 1 End:"), csv().replace("17.76623", "NaN"),
    [...lines().slice(0, -1), lines().at(-2)!].join("\n"),
    [...lines().slice(0, -1), lines()[2]].join("\n"),
  ];
  for (const source of variants) assert.equal(parseFltLayoutReview(source, "Path Successful").csvStatus, "missing_evidence");
});

test("bounded CSV and OUT reject control characters before admitting metadata or reported success", () => {
  for (const character of ["\0", "\t", "\x01", "\x0B", "\x0C", "\x1B", "\x7F", "\x85"]) {
    const result = parseFltLayoutReview(csv().replace(identity, identity + character), "Path Successful");
    assert.equal(result.csvStatus, "missing_evidence");
    assert.equal(result.diagnostics.some(issue => issue.code === "csv_control_character"), true);
  }
  for (const character of ["\0", "\x01", "\x0B", "\x0C", "\x1B", "\x7F", "\x85"]) {
    const result = parseFltLayoutReview(csv(), `Path Successful${character}`);
    assert.equal(result.outStatus, "missing_evidence");
    assert.equal(result.status, "missing_evidence");
    assert.equal(result.diagnostics.some(issue => issue.code === "out_control_character"), true);
  }
  const oversizedCsv = parseFltLayoutReview(" ".repeat(16 * 1024 * 1024 + 1), "Path Successful");
  assert.equal(oversizedCsv.diagnostics.some(issue => issue.code === "csv_budget"), true);
  const oversizedOut = parseFltLayoutReview(csv(), "Path Successful" + " ".repeat(64 * 1024));
  assert.equal(oversizedOut.status, "missing_evidence");
  assert.equal(oversizedOut.diagnostics.some(issue => issue.code === "out_budget"), true);
  const unknownStatus = parseFltLayoutReview(changedCell(2, 27, "PRIVATE UNKNOWN"), "Path Successful");
  assert.equal(unknownStatus.csvStatus, "missing_evidence");
  assert.equal(unknownStatus.status, "missing_evidence");
  assert.equal(JSON.stringify(unknownStatus).includes("PRIVATE UNKNOWN"), false);
  assert.match(parseFltLayoutReview(csv(), "Path Successful").diagnostics.at(-1)!.message, /do not establish .*machine type/);
});
