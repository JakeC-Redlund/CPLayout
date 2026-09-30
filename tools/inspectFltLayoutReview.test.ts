import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLT_LAYOUT_FOOTER_LABELS, FLT_LAYOUT_HEADERS, FLT_LAYOUT_UNSAFE_OUT } from "../packages/core/src/fltLayoutReview";
import { inspectFltLayoutReview, runFltLayoutInspection } from "./inspectFltLayoutReview";

const root = mkdtempSync(join(tmpdir(), "flt-review-synthetic-"));
try {
  const csvPath = join(root, "private-client.csv"), outPath = join(root, "private-client.out");
  const row = Array.from({ length: 27 }, (_, i) => i === 4 ? "123456.789" : String(i));
  const csv = ["private-client,Standard Pivot,15,C:\\private-output", FLT_LAYOUT_HEADERS.join(","),
    [...row, "No Violation"].join(","), ...FLT_LAYOUT_FOOTER_LABELS.map(label => `${label},0`), ""].join("\r\n");
  writeFileSync(csvPath, csv); writeFileSync(outPath, `\n${FLT_LAYOUT_UNSAFE_OUT}\r\n`);
  const result = inspectFltLayoutReview(csvPath, outPath);
  assert.equal(result.status, "constraint_violated");
  assert.equal(result.summary.rowCount, 1);
  assert.equal(result.sources.csv.sha256, createHash("sha256").update(csv).digest("hex"));
  assert.equal(result.qualifiedTrajectory, false);
  assert.equal(result.controllerFileAssociation, "unverified");
  for (const secret of ["private-client", "private-output", "123456.789", root]) assert.equal(JSON.stringify(result).includes(secret), false);
  let output = "";
  assert.equal(runFltLayoutInspection([csvPath, outPath], text => { output = text; }), 2);
  assert.equal(JSON.parse(output).outStatus, "reported_unsafe");
  writeFileSync(outPath, "Path Successful\r\n");
  assert.equal(runFltLayoutInspection([csvPath, outPath], text => { output = text; }), 3);
  assert.equal(JSON.parse(output).status, "numerically_unresolved");
  assert.equal(runFltLayoutInspection([csvPath], text => { output = text; }), 3);
  assert.equal(JSON.parse(output).status, "missing_evidence");
  assert.equal(readFileSync(csvPath, "utf8"), csv);
  assert.equal(runFltLayoutInspection([join(root, "missing-private.csv")], text => { output = text; }), 1);
  assert.equal(output.includes(root), false);
  assert.equal(output.includes("missing-private"), false);
  writeFileSync(outPath, Buffer.from([0xc3, 0x28]));
  assert.equal(runFltLayoutInspection([csvPath, outPath], text => { output = text; }), 1);
  assert.equal(runFltLayoutInspection([], () => {}), 64);
  assert.equal(runFltLayoutInspection(["--help"], () => {}), 0);
  console.log("FLT review inspection tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
