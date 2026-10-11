const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { isUtf8 } = require("node:buffer");

const severities = ["info", "low", "moderate", "high", "critical"];
const admitted = new Map([
  ["https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", { name: "braces", version: "3.0.3", range: "<=3.0.3", severity: "high" }],
  ["https://github.com/advisories/GHSA-86w9-cpqp-85rv", { name: "node-forge", version: "1.4.0", range: "<=1.4.0", severity: "high" }],
  ["https://github.com/advisories/GHSA-hp3w-g68c-fv3c", { name: "sprintf-js", version: "1.0.3", range: "<=1.1.3", severity: "moderate" }]
]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const string = value => typeof value === "string" && value.length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sha256 = value => createHash("sha256").update(value).digest("hex");
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function keys(value, required, context) {
  requireThat(object(value), context + " must be an object");
  requireThat(Object.keys(value).length === required.length && required.every(key => own(value, key)), context + " has unsupported or missing fields");
}
function stringArray(value, context, nonempty = false) {
  requireThat(Array.isArray(value) && (!nonempty || value.length > 0) && value.every(string) && new Set(value).size === value.length, context + " must contain distinct strings");
}
function validNode(value) {
  // npm audit paths must identify real installed modules, never an arbitrary file.
  return string(value) && /^(?:node_modules\/(?:@[^/\\.]+\/)?[^/\\.]+)(?:\/node_modules\/(?:@[^/\\.]+\/)?[^/\\.]+)*$/.test(value);
}

function validateReport(report, processResult) {
  requireThat(processResult && !processResult.error && !processResult.signal && [0, 1].includes(processResult.status), "npm audit failed or returned an unknown exit status");
  requireThat(!/npm\s+(?:ERR!(?:\s|$)|error\b)|ENOTFOUND|EAI_AGAIN|ECONN(?:RESET|REFUSED)|ETIMEDOUT|failed\s+(?:to\s+)?fetch/i.test(String(processResult.stderr || "")), "npm audit reported a fetch or process error");
  keys(report, ["auditReportVersion", "vulnerabilities", "metadata"], "Audit report");
  requireThat(report.auditReportVersion === 2, "Unsupported auditReportVersion");
  requireThat(object(report.vulnerabilities), "Audit vulnerabilities must be an object");
  keys(report.metadata, ["vulnerabilities", "dependencies"], "Audit metadata");
  keys(report.metadata.vulnerabilities, [...severities, "total"], "Severity metadata");
  keys(report.metadata.dependencies, ["prod", "dev", "optional", "peer", "peerOptional", "total"], "Dependency metadata");
  for (const value of Object.values(report.metadata.dependencies)) requireThat(integer(value), "Invalid dependency count");
  // npm dependency categories overlap; their sum is not the unique total.
  for (const [category, count] of Object.entries(report.metadata.dependencies)) {
    requireThat(count <= report.metadata.dependencies.total, "Dependency count exceeds total: " + category);
  }
  const counts = Object.fromEntries([...severities, "total"].map(severity => [severity, 0]));
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    keys(vulnerability, ["name", "severity", "isDirect", "via", "effects", "range", "nodes", "fixAvailable"], "Vulnerability " + name);
    requireThat(string(name) && vulnerability.name === name && severities.includes(vulnerability.severity) && typeof vulnerability.isDirect === "boolean" && string(vulnerability.range), "Invalid vulnerability " + name);
    stringArray(vulnerability.effects, "Effects for " + name);
    stringArray(vulnerability.nodes, "Nodes for " + name, true);
    requireThat(vulnerability.nodes.every(validNode), "Invalid installed node path for " + name);
    requireThat(Array.isArray(vulnerability.via) && vulnerability.via.length > 0, "Empty or invalid via for " + name);
    if (typeof vulnerability.fixAvailable !== "boolean") {
      keys(vulnerability.fixAvailable, ["name", "version", "isSemVerMajor"], "Fix for " + name);
      requireThat(string(vulnerability.fixAvailable.name) && string(vulnerability.fixAvailable.version) && typeof vulnerability.fixAvailable.isSemVerMajor === "boolean", "Invalid fix for " + name);
    }
    for (const via of vulnerability.via) {
      if (typeof via === "string") {
        requireThat(string(via) && own(report.vulnerabilities, via), "Missing via reference from " + name + ": " + via);
      } else {
        keys(via, ["source", "name", "dependency", "title", "url", "severity", "cwe", "cvss", "range"], "Advisory for " + name);
        requireThat(integer(via.source) && via.source > 0 && via.name === name && via.dependency === name && string(via.title) && string(via.url) && severities.includes(via.severity) && string(via.range), "Invalid advisory for " + name);
        stringArray(via.cwe, "CWE for " + name);
        keys(via.cvss, ["score", "vectorString"], "CVSS for " + name);
        requireThat((via.cvss.score === null || (typeof via.cvss.score === "number" && Number.isFinite(via.cvss.score) && via.cvss.score >= 0 && via.cvss.score <= 10)) && (via.cvss.vectorString === null || string(via.cvss.vectorString)), "Invalid CVSS for " + name);
      }
    }
    counts[vulnerability.severity]++;
    counts.total++;
  }
  for (const severity of [...severities, "total"]) {
    requireThat(integer(report.metadata.vulnerabilities[severity]) && report.metadata.vulnerabilities[severity] === counts[severity], "Severity metadata mismatch: " + severity);
  }
  requireThat(counts.total <= report.metadata.dependencies.total, "Vulnerability count exceeds dependency count");
  requireThat(processResult.status === (counts.total === 0 ? 0 : 1), "Audit exit status does not match findings");
  return counts;
}

function resolveAdvisories(report) {
  const roots = Object.create(null);
  const leaves = new Map();
  // npm's Metro graph has cycles WITH advisory exits. Visiting each reachable
  // package once resolves those cycles; any component with no leaf fails below.
  for (const name of Object.keys(report.vulnerabilities)) {
    const pending = [name];
    const visited = new Set();
    const reachable = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const via of report.vulnerabilities[current].via) {
        if (typeof via === "string") pending.push(via);
        else {
          const policy = admitted.get(via.url);
          requireThat(policy && via.name === policy.name && via.dependency === policy.name && via.severity === policy.severity && via.range === policy.range, "Unadmitted advisory: " + via.url + " (" + via.name + ")");
          reachable.add(via.url);
          leaves.set(via.url, { ...policy, url: via.url });
        }
      }
    }
    requireThat(reachable.size > 0, "Unresolved advisory cycle or empty root: " + name);
    roots[name] = [...reachable].sort();
    const severity = report.vulnerabilities[name].severity;
    const expectedSeverity = severities[Math.max(...[...reachable].map(url => severities.indexOf(admitted.get(url).severity)))];
    requireThat(severity === expectedSeverity, "Unexpected propagated severity for " + name + ": " + severity);
  }
  return { roots, leaves: [...leaves.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function verifyInstalledPatches(root, report) {
  // Lazy loading lets focused schema tests run before the independently owned
  // helper exists. A missing helper always fails the actual CLI decision.
  const helper = require("./patchDependencySecurity.cjs");
  requireThat(typeof helper.verifyDependencySecurity === "function", "Installed security verifier is unavailable");
  const patchStatus = helper.verifyDependencySecurity(root);
  requireThat(patchStatus === "already-installed", "Dependency patches were not verified as installed");
  requireThat(typeof helper.checkAuditDependencyNodes === "function", "Installed audit-node verifier is unavailable");
  return helper.checkAuditDependencyNodes(root, report);
}

function evaluateAudit(report, processResult, { root, verifyPatches = verifyInstalledPatches } = {}) {
  const counts = validateReport(report, processResult);
  const graph = resolveAdvisories(report);
  // A clean registry response does not prove the installed guards are current.
  // Require the same source/copy provenance even when there are no audit nodes.
  requireThat(string(root), "Installed dependency root is required");
  const proof = verifyPatches(root, report);
  requireThat(object(proof) && proof.patches === "already-installed" && Array.isArray(proof.nodes), "Installed patch verifier returned no verified node evidence");
  const expected = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const node of vulnerability.nodes) {
      requireThat(!expected.has(node), "Audit node occurs under multiple packages: " + node);
      expected.set(node, vulnerability.name);
    }
  }
  const seen = new Set();
  for (const node of proof.nodes) {
    requireThat(object(node) && expected.get(node.path) === node.name && !seen.has(node.path) && string(node.version), "Unexpected or duplicate installed node evidence");
    seen.add(node.path);
    const leaf = graph.leaves.find(advisory => advisory.name === node.name);
    if (leaf) requireThat(node.version === leaf.version && node.patched === true, "Unpatched or incompatible advisory node: " + node.path);
  }
  requireThat(seen.size === expected.size, "Installed patch verification omitted an audit node");
  if (counts.total === 0) return { decision: "no-reported-vulnerabilities", rawCounts: counts, advisoryRoots: graph.roots, admittedAdvisories: [], verifiedNodes: proof.nodes, mitigation: "No vulnerabilities reported by this audit; installed local patches verified. No security guarantee implied." };
  return { decision: "admitted-local-mitigations", rawCounts: counts, advisoryRoots: graph.roots, admittedAdvisories: graph.leaves, verifiedNodes: proof.nodes, mitigation: "Only the three named advisories are admitted with verified local patches. Raw npm findings remain; this is not a zero-audit or upstream-fixed claim." };
}

function runAudit(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  requireThat(JSON.stringify(manifest.workspaces) === JSON.stringify(["apps/*", "packages/*"]), "Unknown workspace topology; audit coverage must be reviewed");
  // A CLI prefix fixes npm's project root despite environment/.npmrc config.
  // Includes override omit/production; workspace parents cover every workspace.
  const args = ["audit", "--prefix=" + root, "--json", "--include=dev", "--include=optional", "--include=peer", "--workspaces", "--include-workspace-root", "--workspace=apps", "--workspace=packages", "--audit-level=info"];
  const startedAt = new Date().toISOString();
  const result = spawnSync("npm", args, { cwd: root, encoding: "buffer", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout || Buffer.alloc(0);
  const stderr = result.stderr || Buffer.alloc(0);
  const directory = path.join(root, "reports", "dependency-audit");
  fs.mkdirSync(directory, { recursive: true });
  const outputDirectory = fs.mkdtempSync(path.join(directory, startedAt.replace(/[:.]/g, "-") + "-"));
  fs.writeFileSync(path.join(outputDirectory, "audit.stdout.json"), stdout);
  fs.writeFileSync(path.join(outputDirectory, "audit.stderr.log"), stderr);
  const metadata = { command: ["npm", ...args], cwd: root, startedAt, completedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code || null } : null, stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
  fs.writeFileSync(path.join(outputDirectory, "process.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log("Raw audit artifacts: " + outputDirectory);
  let decision;
  try {
    requireThat(isUtf8(stdout), "Audit stdout is not valid UTF-8 JSON");
    const report = JSON.parse(stdout.toString("utf8"));
    if (report.metadata && report.metadata.vulnerabilities) console.log("Raw npm audit counts (before validation): " + JSON.stringify(report.metadata.vulnerabilities));
    decision = evaluateAudit(report, { ...metadata, stderr: stderr.toString("utf8") }, { root });
    console.log("Dependency audit decision: " + decision.decision + ". " + decision.mitigation);
  } catch (error) {
    decision = { decision: "rejected", reason: error.message };
    console.error("Dependency audit rejected: " + error.message);
  }
  fs.writeFileSync(path.join(outputDirectory, "decision.json"), JSON.stringify(decision, null, 2) + "\n");
  return decision.decision === "rejected" ? 1 : 0;
}

module.exports = { evaluateAudit, validateReport, resolveAdvisories, runAudit };
if (require.main === module) {
  if (process.argv.length !== 2) {
    console.error("Dependency audit accepts no arguments or exemption flags");
    process.exitCode = 1;
  } else process.exitCode = runAudit(path.resolve(__dirname, ".."));
}
