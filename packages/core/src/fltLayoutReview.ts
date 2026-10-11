/** Evidence reader for the locally observed FLT CSV/OUT format, not a geometry importer. */
export const FLT_LAYOUT_NUMERIC_HEADERS = [
  "index", "pivot angle", "pivot length", "corner angle", "corner end X", "corner end Y",
  "ER1", "ER2", "ABS", "end bearing", "distGT/distGTmax", "distET/distETmax", "distET/distGP",
  "distLRDU", "distGT", "distGTMax", "distET", "distETmax", "VRI", "VRI Cond", "VRI Min",
  "ET Dist", "Bdry Dist", "ET-LRDU Dist", "GP-LRDU Dist", "Variable Acres", "End Gun Acres",
] as const;
export const FLT_LAYOUT_HEADERS = [...FLT_LAYOUT_NUMERIC_HEADERS, "Violation "] as const;
export const FLT_LAYOUT_FOOTER_LABELS = [
  "guidance path length", "pivot acres", "corner acres", "total acres", "endgun acres", "variable acres",
] as const;
export const FLT_LAYOUT_UNSAFE_OUT = "The end gun to boundary distance is less than the allowed distance, and will result in damage to the machine. Adjusting machine length required.";

export type FltLayoutNumericHeader = typeof FLT_LAYOUT_NUMERIC_HEADERS[number];
export type FltLayoutFooterLabel = typeof FLT_LAYOUT_FOOTER_LABELS[number];
export interface FltLayoutReviewRow {
  /** Original numerical column names; corner end X/Y are not canonical project XY. */
  values: Record<FltLayoutNumericHeader, number>;
  violation: "No Violation";
}
export interface FltLayoutEndgunEvent { index: number; startDegrees: number; endDegrees: number }
export interface FltLayoutReview {
  schemaVersion: "flt-layout-review-v1";
  status: "constraint_violated" | "missing_evidence" | "numerically_unresolved";
  csvStatus: "parsed_observed_format" | "missing_evidence";
  outStatus: "reported_path_successful" | "reported_unsafe" | "missing_evidence" | "unrecognized";
  rows: FltLayoutReviewRow[];
  footers: Array<{ label: FltLayoutFooterLabel; value: number }>;
  endgunEvents: FltLayoutEndgunEvent[];
  coordinates: {
    sourceColumns: readonly ["corner end X", "corner end Y"];
    numericRepresentation: "binary64";
    units: "unresolved"; referencePoint: "unresolved"; crs: "unresolved"; interpolation: "unresolved";
    canonicalGeometryImported: false;
  };
  closure: {
    /** Equality of parsed binary64 values only, not exact source decimals or a cycle proof. */
    firstLastCornerEnd: "equal" | "different" | "insufficient_rows";
    appendedClosingRow: false;
    cycleQualification: "unresolved";
  };
  /** Contains no source metadata, output directory, coordinate values, or raw OUT text. */
  summary: { rowCount: number; footerCount: number; endgunEventCount: number; qualifiedTrajectory: false };
  diagnostics: Array<{ code: string; message: string; line?: number }>;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_TEXT_LENGTH = 16 * 1024 * 1024;
const MAX_OUT_TEXT_LENGTH = 64 * 1024;
const MAX_ROWS = 20_000;
const CSV_CONTROL_CHARACTERS = /[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const OUT_CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

function numeric(value: string): number | null {
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const parsed = Number(text);
  // Ordinary binary64 rounding is disclosed; nonzero-to-zero underflow is refused.
  if (parsed === 0 && /[1-9]/.test(text.split(/[eE]/)[0])) return null;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Supports unquoted CRLF or LF records only. Unsupported quoting and unknown
 * sections fail closed. No metadata or raw error text is retained in the result.
 * Pairing/authenticity of the supplied CSV and OUT remains caller evidence.
 */
export function parseFltLayoutReview(csvText: unknown, outText?: unknown): FltLayoutReview {
  const result: FltLayoutReview = {
    schemaVersion: "flt-layout-review-v1", status: "missing_evidence", csvStatus: "missing_evidence",
    outStatus: "missing_evidence", rows: [], footers: [], endgunEvents: [],
    coordinates: { sourceColumns: ["corner end X", "corner end Y"], numericRepresentation: "binary64", units: "unresolved",
      referencePoint: "unresolved", crs: "unresolved", interpolation: "unresolved", canonicalGeometryImported: false },
    closure: { firstLastCornerEnd: "insufficient_rows", appendedClosingRow: false, cycleQualification: "unresolved" },
    summary: { rowCount: 0, footerCount: 0, endgunEventCount: 0, qualifiedTrajectory: false }, diagnostics: [],
  };
  const fail = (code: string, message: string, line?: number): void => {
    result.diagnostics.push({ code, message, ...(line === undefined ? {} : { line }) });
  };
  if (typeof outText === "string") {
    if (outText.length > MAX_OUT_TEXT_LENGTH) {
      fail("out_budget", "OUT exceeds the evidence-reader size limit.");
    } else if (OUT_CONTROL_CHARACTERS.test(outText)) {
      fail("out_control_character", "OUT contains unsupported control characters.");
    } else if (outText.trim()) {
      const normalized = outText.trim().replace(/\s+/g, " ");
      result.outStatus = outText.trim() === "Path Successful" ? "reported_path_successful"
        : normalized === FLT_LAYOUT_UNSAFE_OUT ? "reported_unsafe" : "unrecognized";
    }
  }
  const readCsv = (): void => {
    if (typeof csvText !== "string") { fail("csv_missing", "FLT CSV text is required."); return; }
    if (csvText.length > MAX_TEXT_LENGTH) { fail("csv_budget", "CSV exceeds the evidence-reader size limit."); return; }
    if (CSV_CONTROL_CHARACTERS.test(csvText)) { fail("csv_control_character", "CSV contains unsupported control characters."); return; }
    if (!csvText.trim()) { fail("csv_missing", "FLT CSV text is required."); return; }
    if (csvText.includes('"')) { fail("csv_quoting_unsupported", "Quoted CSV fields are outside the observed supported format."); return; }
    const lines = csvText.replace(/\r\n/g, "\n").split("\n");
    while (lines.at(-1) === "") lines.pop();
    if (lines.length > MAX_ROWS + 1024 || lines.some(line => line.includes("\r"))) {
      fail("csv_format_budget", "Unsupported line endings or CSV record budget exceeded."); return;
    }
    const metadata = (lines[0] ?? "").split(",");
    if (metadata.length !== 4 || metadata.some(value => !value.trim())
      || metadata[1] !== "Standard Pivot" || numeric(metadata[2]) === null) {
      fail("csv_metadata", "Expected the observed four-field Standard Pivot metadata record.", 1); return;
    }
    const header = (lines[1] ?? "").split(",");
    if (header.length !== FLT_LAYOUT_HEADERS.length || header.some((value, index) => value !== FLT_LAYOUT_HEADERS[index])) {
      fail("csv_headers", "CSV columns do not exactly match the observed FLT layout format.", 2); return;
    }
    const rows: FltLayoutReviewRow[] = [];
    let cursor = 2;
    for (; cursor < lines.length; cursor++) {
      const cells = lines[cursor].split(",");
      if (cells[0] === FLT_LAYOUT_FOOTER_LABELS[0]) break;
      if (rows.length >= MAX_ROWS || cells.length !== FLT_LAYOUT_HEADERS.length) {
        fail("csv_row_width", "Expected a bounded 28-column numerical layout row before the footer.", cursor + 1); return;
      }
      const numbers = cells.slice(0, -1).map(numeric);
      if (numbers.some(value => value === null)) {
        fail("csv_numeric", "Every numerical column must contain a finite decimal value without nonzero-to-zero underflow.", cursor + 1); return;
      }
      if (cells.at(-1) !== "No Violation") {
        fail("csv_violation_unknown", "Unrecognized CSV violation status; no clean-row conclusion is available.", cursor + 1); return;
      }
      const values = Object.fromEntries(FLT_LAYOUT_NUMERIC_HEADERS.map((name, index) => [name, numbers[index]])) as Record<FltLayoutNumericHeader, number>;
      if (!Number.isSafeInteger(values.index) || values.index < 0 || (rows.length > 0 && values.index <= rows.at(-1)!.values.index)) {
        fail("csv_index_order", "Row indices must be distinct, strictly increasing, nonnegative safe integers.", cursor + 1); return;
      }
      rows.push({ values, violation: "No Violation" });
    }
    if (!rows.length) { fail("csv_rows_missing", "At least one numerical layout row is required."); return; }
    const footers: FltLayoutReview["footers"] = [];
    for (const label of FLT_LAYOUT_FOOTER_LABELS) {
      const cells = (lines[cursor] ?? "").split(",");
      const value = cells.length === 2 ? numeric(cells[1]) : null;
      if (cells[0] !== label || value === null) {
        fail("csv_footer", "Expected the six observed two-field numerical footers in order.", cursor + 1); return;
      }
      footers.push({ label, value }); cursor++;
    }
    const endgunEvents: FltLayoutEndgunEvent[] = [];
    for (; cursor < lines.length; cursor++) {
      const match = /^Endgun (\d+) Start: (\S+) Degrees Endgun (\d+) End: (\S+) Degrees$/.exec(lines[cursor]);
      const start = match ? numeric(match[2]) : null, end = match ? numeric(match[4]) : null;
      const index = match ? Number(match[1]) : NaN;
      if (!match || !Number.isSafeInteger(index) || index !== Number(match[3]) || start === null || end === null
        || endgunEvents.some(event => event.index === index)) {
        fail("csv_trailing_section", "Unknown, malformed, or duplicate endgun footer record.", cursor + 1); return;
      }
      endgunEvents.push({ index, startDegrees: start, endDegrees: end });
    }
    result.rows = rows; result.footers = footers; result.endgunEvents = endgunEvents;
    result.csvStatus = "parsed_observed_format";
    result.summary = { rowCount: rows.length, footerCount: footers.length, endgunEventCount: endgunEvents.length, qualifiedTrajectory: false };
    if (rows.length > 1) {
      const first = rows[0].values, last = rows.at(-1)!.values;
      result.closure.firstLastCornerEnd = first["corner end X"] === last["corner end X"] && first["corner end Y"] === last["corner end Y"] ? "equal" : "different";
    }
  };
  readCsv();
  if (result.outStatus === "reported_unsafe") {
    result.status = "constraint_violated";
    fail("out_unsafe", "Paired OUT reports unsafe end-gun boundary distance and required machine-length adjustment; CSV rows do not override this report.");
  } else if (result.outStatus === "missing_evidence") {
    fail("out_missing", "Paired OUT evidence is required; CSV rows alone do not establish success.");
  } else {
    result.status = result.csvStatus === "missing_evidence" ? "missing_evidence" : "numerically_unresolved";
    if (result.outStatus === "unrecognized") fail("out_unrecognized", "OUT text is outside the observed statuses and remains unresolved.");
  }
  fail("trajectory_unqualified", "Format admission and reported OUT status do not establish CSV/OUT pairing, machine type, units, reference point, CRS, interpolation, continuous clearance, or controller compatibility.");
  return result;
}
