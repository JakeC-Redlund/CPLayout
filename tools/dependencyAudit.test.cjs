const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { evaluateAudit } = require("./dependencyAudit.cjs");
// Exact captured npm audit v2 r36 graph, including Metro cycles and 21 high findings.
const captured = {
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@expo/cli": {
      "name": "@expo/cli",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@expo/code-signing-certificates",
        "@expo/metro",
        "@expo/metro-config",
        "node-forge"
      ],
      "effects": [
        "expo"
      ],
      "range": "<=0.0.0-canary-20231123-1b19f96-4 || >=0.0.1-canary-20231125-d600e44",
      "nodes": [
        "node_modules/expo/node_modules/@expo/cli"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "@expo/code-signing-certificates": {
      "name": "@expo/code-signing-certificates",
      "severity": "high",
      "isDirect": false,
      "via": [
        "node-forge"
      ],
      "effects": [],
      "range": "*",
      "nodes": [
        "node_modules/@expo/code-signing-certificates"
      ],
      "fixAvailable": true
    },
    "@expo/metro": {
      "name": "@expo/metro",
      "severity": "high",
      "isDirect": false,
      "via": [
        "metro",
        "metro-config",
        "metro-file-map",
        "metro-transform-worker"
      ],
      "effects": [
        "@expo/cli",
        "@expo/metro-config",
        "expo"
      ],
      "range": "*",
      "nodes": [
        "node_modules/@expo/metro"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "@expo/metro-config": {
      "name": "@expo/metro-config",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@expo/metro"
      ],
      "effects": [
        "expo"
      ],
      "range": ">=0.21.0-canary-20250630-547cd82",
      "nodes": [
        "node_modules/@expo/metro-config"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "@jest/environment": {
      "name": "@jest/environment",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@jest/fake-timers"
      ],
      "effects": [],
      "range": "<=30.2.0",
      "nodes": [
        "node_modules/@jest/environment"
      ],
      "fixAvailable": true
    },
    "@jest/fake-timers": {
      "name": "@jest/fake-timers",
      "severity": "high",
      "isDirect": false,
      "via": [
        "jest-message-util"
      ],
      "effects": [
        "@jest/environment",
        "jest-environment-node"
      ],
      "range": "<=30.2.0",
      "nodes": [
        "node_modules/@jest/fake-timers"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "@jest/transform": {
      "name": "@jest/transform",
      "severity": "high",
      "isDirect": false,
      "via": [
        "jest-haste-map",
        "micromatch"
      ],
      "effects": [
        "babel-jest"
      ],
      "range": "<=30.2.0",
      "nodes": [
        "node_modules/@jest/transform"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "@react-native/community-cli-plugin": {
      "name": "@react-native/community-cli-plugin",
      "severity": "high",
      "isDirect": false,
      "via": [
        "metro",
        "metro-config"
      ],
      "effects": [
        "react-native"
      ],
      "range": "*",
      "nodes": [
        "node_modules/@react-native/community-cli-plugin"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "babel-jest": {
      "name": "babel-jest",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@jest/transform"
      ],
      "effects": [
        "react-native"
      ],
      "range": "24.2.0-alpha.0 - 30.2.0",
      "nodes": [
        "node_modules/babel-jest"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "braces": {
      "name": "braces",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240992,
          "name": "braces",
          "dependency": "braces",
          "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
          "url": "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          "severity": "high",
          "cwe": [
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": "<=3.0.3"
        }
      ],
      "effects": [
        "micromatch"
      ],
      "range": "*",
      "nodes": [
        "node_modules/braces"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "expo": {
      "name": "expo",
      "severity": "high",
      "isDirect": true,
      "via": [
        "@expo/cli",
        "@expo/metro",
        "@expo/metro-config"
      ],
      "effects": [],
      "range": ">=45.0.0-beta.1",
      "nodes": [
        "node_modules/expo"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "jest-environment-node": {
      "name": "jest-environment-node",
      "severity": "high",
      "isDirect": false,
      "via": [
        "@jest/environment",
        "@jest/fake-timers"
      ],
      "effects": [
        "react-native"
      ],
      "range": "24.2.0-alpha.0 - 30.2.0",
      "nodes": [
        "node_modules/jest-environment-node"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "jest-haste-map": {
      "name": "jest-haste-map",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [],
      "range": "18.1.0 - 30.2.0",
      "nodes": [
        "node_modules/jest-haste-map"
      ],
      "fixAvailable": true
    },
    "jest-message-util": {
      "name": "jest-message-util",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [
        "@jest/fake-timers"
      ],
      "range": "18.5.0-alpha.7da3df39 - 30.2.0",
      "nodes": [
        "node_modules/jest-message-util"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "metro": {
      "name": "metro",
      "severity": "high",
      "isDirect": false,
      "via": [
        "metro-config",
        "metro-file-map",
        "metro-transform-worker"
      ],
      "effects": [
        "@react-native/community-cli-plugin",
        "metro-config",
        "metro-transform-worker"
      ],
      "range": ">=0.71.0",
      "nodes": [
        "node_modules/metro"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "metro-config": {
      "name": "metro-config",
      "severity": "high",
      "isDirect": false,
      "via": [
        "metro"
      ],
      "effects": [
        "@react-native/community-cli-plugin"
      ],
      "range": ">=0.71.0",
      "nodes": [
        "node_modules/metro-config"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    },
    "metro-file-map": {
      "name": "metro-file-map",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [
        "@expo/metro",
        "metro"
      ],
      "range": "*",
      "nodes": [
        "node_modules/metro-file-map"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "metro-transform-worker": {
      "name": "metro-transform-worker",
      "severity": "high",
      "isDirect": false,
      "via": [
        "metro"
      ],
      "effects": [],
      "range": ">=0.71.0",
      "nodes": [
        "node_modules/metro-transform-worker"
      ],
      "fixAvailable": true
    },
    "micromatch": {
      "name": "micromatch",
      "severity": "high",
      "isDirect": false,
      "via": [
        "braces"
      ],
      "effects": [
        "@jest/transform",
        "jest-haste-map",
        "jest-message-util",
        "metro-file-map"
      ],
      "range": ">=0.2.0",
      "nodes": [
        "node_modules/micromatch"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "node-forge": {
      "name": "node-forge",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240912,
          "name": "node-forge",
          "dependency": "node-forge",
          "title": "node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements",
          "url": "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
          "severity": "high",
          "cwe": [
            "CWE-347"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N"
          },
          "range": "<=1.4.0"
        }
      ],
      "effects": [
        "@expo/cli",
        "@expo/code-signing-certificates"
      ],
      "range": "*",
      "nodes": [
        "node_modules/node-forge"
      ],
      "fixAvailable": {
        "name": "expo",
        "version": "44.0.6",
        "isSemVerMajor": true
      }
    },
    "react-native": {
      "name": "react-native",
      "severity": "high",
      "isDirect": true,
      "via": [
        "@react-native/community-cli-plugin",
        "babel-jest",
        "jest-environment-node"
      ],
      "effects": [],
      "range": "<=0.0.0-ffdfbbec0 || >=0.71.0-rc.0",
      "nodes": [
        "node_modules/react-native"
      ],
      "fixAvailable": {
        "name": "react-native",
        "version": "0.87.1",
        "isSemVerMajor": true
      }
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 21,
      "critical": 0,
      "total": 21
    },
    "dependencies": {
      "prod": 698,
      "dev": 32,
      "optional": 39,
      "peer": 0,
      "peerOptional": 0,
      "total": 741
    }
  }
};

// Five newly captured moderate nodes; the upstream-fixable source-map leaf is excluded
// from this known-guard fixture and explicitly rejected below.
const capturedModerate = {
  "@istanbuljs/load-nyc-config": {
    "name": "@istanbuljs/load-nyc-config",
    "severity": "moderate",
    "isDirect": false,
    "via": [
      "js-yaml"
    ],
    "effects": [
      "babel-plugin-istanbul"
    ],
    "range": "*",
    "nodes": [
      "node_modules/@istanbuljs/load-nyc-config"
    ],
    "fixAvailable": {
      "name": "react-native",
      "version": "0.87.1",
      "isSemVerMajor": true
    }
  },
  "argparse": {
    "name": "argparse",
    "severity": "moderate",
    "isDirect": false,
    "via": [
      "sprintf-js"
    ],
    "effects": [
      "js-yaml"
    ],
    "range": "1.0.0 - 1.0.10",
    "nodes": [
      "node_modules/argparse"
    ],
    "fixAvailable": {
      "name": "react-native",
      "version": "0.87.1",
      "isSemVerMajor": true
    }
  },
  "babel-plugin-istanbul": {
    "name": "babel-plugin-istanbul",
    "severity": "moderate",
    "isDirect": false,
    "via": [
      "@istanbuljs/load-nyc-config"
    ],
    "effects": [
      "@jest/transform",
      "babel-jest"
    ],
    "range": ">=6.0.0-beta.0",
    "nodes": [
      "node_modules/babel-plugin-istanbul"
    ],
    "fixAvailable": {
      "name": "react-native",
      "version": "0.87.1",
      "isSemVerMajor": true
    }
  },
  "js-yaml": {
    "name": "js-yaml",
    "severity": "moderate",
    "isDirect": false,
    "via": [
      "argparse"
    ],
    "effects": [
      "@istanbuljs/load-nyc-config"
    ],
    "range": "3.2.7 - 3.15.2",
    "nodes": [
      "node_modules/js-yaml"
    ],
    "fixAvailable": {
      "name": "react-native",
      "version": "0.87.1",
      "isSemVerMajor": true
    }
  },
  "sprintf-js": {
    "name": "sprintf-js",
    "severity": "moderate",
    "isDirect": false,
    "via": [
      {
        "source": 1241202,
        "name": "sprintf-js",
        "dependency": "sprintf-js",
        "title": "sprintf-js vulnerable to denial of service through unbounded precision specifiers",
        "url": "https://github.com/advisories/GHSA-hp3w-g68c-fv3c",
        "severity": "moderate",
        "cwe": [
          "CWE-1284"
        ],
        "cvss": {
          "score": 5.3,
          "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"
        },
        "range": "<=1.1.3"
      }
    ],
    "effects": [
      "argparse"
    ],
    "range": "*",
    "nodes": [
      "node_modules/sprintf-js"
    ],
    "fixAvailable": {
      "name": "react-native",
      "version": "0.87.1",
      "isSemVerMajor": true
    }
  }
};

const clone = () => structuredClone(captured);
const zeroReport = () => {
  const report = clone();
  report.vulnerabilities = {};
  report.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  return report;
};
const recount = report => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const vulnerability of Object.values(report.vulnerabilities)) { counts[vulnerability.severity]++; counts.total++; }
  report.metadata.vulnerabilities = counts;
  return report;
};
const mixedReport = () => {
  const report = clone();
  Object.assign(report.vulnerabilities, structuredClone(capturedModerate));
  // A parent already reaching a high leaf stays high when a moderate exit is added.
  report.vulnerabilities.expo.via.push('sprintf-js');
  return recount(report);
};
const installedProof = report => ({
  patches: "already-installed",
  nodes: Object.values(report.vulnerabilities).flatMap(vulnerability => vulnerability.nodes.map(node => ({
    path: node,
    name: vulnerability.name,
    version: vulnerability.name === "braces" ? "3.0.3" : vulnerability.name === "node-forge" ? "1.4.0" : vulnerability.name === "sprintf-js" ? "1.0.3" : "1.0.0",
    patched: ["braces", "node-forge", "sprintf-js"].includes(vulnerability.name)
  })))
});
const evaluate = (report, verifyPatches = (_root, input) => installedProof(input), processResult = { status: 1, signal: null, error: null }) => evaluateAudit(report, processResult, { root: "/synthetic-unit-root", verifyPatches });

test("captured 21-high graph resolves all transitive roots including Metro cycles", () => {
  let calls = 0;
  const result = evaluate(clone(), (_root, report) => { calls++; return installedProof(report); });
  assert.equal(calls, 1);
  assert.equal(result.decision, "admitted-local-mitigations");
  assert.equal(result.rawCounts.high, 21);
  assert.equal(result.rawCounts.total, 21);
  assert.equal(Object.keys(result.advisoryRoots).length, 21);
  assert.deepEqual(result.advisoryRoots.expo, ["https://github.com/advisories/GHSA-86w9-cpqp-85rv", "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"]);
  assert.deepEqual(result.advisoryRoots["metro-config"], ["https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"]);
  assert.match(result.mitigation, /not a zero-audit/);
});

test("exact guarded sprintf advisory admits its moderate chain while mixed parents remain high", () => {
  const result = evaluate(mixedReport());
  assert.equal(result.decision, "admitted-local-mitigations");
  assert.equal(result.rawCounts.high, 21);
  assert.equal(result.rawCounts.moderate, 5);
  assert.equal(result.rawCounts.total, 26);
  assert.equal(result.admittedAdvisories.length, 3);
  assert.deepEqual(result.advisoryRoots.argparse, ['https://github.com/advisories/GHSA-hp3w-g68c-fv3c']);
  assert.ok(result.advisoryRoots.expo.includes('https://github.com/advisories/GHSA-hp3w-g68c-fv3c'));
  assert.deepEqual(result.verifiedNodes.find(node => node.name === 'sprintf-js'), { path: 'node_modules/sprintf-js', name: 'sprintf-js', version: '1.0.3', patched: true });
});

test("sprintf advisory severity/range and installed version/source proof stay exact", () => {
  for (const mutate of [
    report => { report.vulnerabilities['sprintf-js'].via[0].severity = 'high'; },
    report => { report.vulnerabilities['sprintf-js'].via[0].range = '<=1.0.3'; },
    report => { report.vulnerabilities['sprintf-js'].via[0].url += '?trusted=true'; },
    report => { report.vulnerabilities.argparse.severity = 'high'; recount(report); }
  ]) {
    const report = mixedReport(); mutate(report);
    assert.throws(() => evaluate(report), /Unadmitted advisory|Unexpected propagated severity/);
  }
  for (const mutate of [
    proof => { proof.nodes.find(node => node.name === 'sprintf-js').version = '1.1.3'; },
    proof => { proof.nodes.find(node => node.name === 'sprintf-js').patched = false; },
    proof => { proof.nodes = proof.nodes.filter(node => node.name !== 'sprintf-js'); }
  ]) {
    const report = mixedReport(), proof = installedProof(report); mutate(proof);
    assert.throws(() => evaluate(report, () => proof), /Unpatched or incompatible|omitted an audit node/);
  }
});

test("source-map-js remains an unadmitted leaf despite a published upstream fix", () => {
  const report = mixedReport();
  report.vulnerabilities['source-map-js'] = {
    name: 'source-map-js', severity: 'high', isDirect: false, effects: [], range: '>=1.0.0 <1.2.2', nodes: ['node_modules/source-map-js'], fixAvailable: true,
    via: [{ ...report.vulnerabilities.braces.via[0], source: 1241209, name: 'source-map-js', dependency: 'source-map-js', url: 'https://github.com/advisories/GHSA-68fv-2mgg-jv7q', range: '>=1.0.0 <1.2.2' }]
  };
  recount(report);
  assert.equal(report.metadata.vulnerabilities.total, 27);
  assert.throws(() => evaluate(report), /Unadmitted advisory:.*GHSA-68fv-2mgg-jv7q/);
});

test("a valid zero-result audit requires exit zero and current installed guard proof", () => {
  const report = zeroReport();
  let calls = 0;
  const result = evaluate(report, (root, input) => {
    calls++;
    assert.equal(root, "/synthetic-unit-root");
    assert.deepEqual(input, report);
    return installedProof(input);
  }, { status: 0 });
  assert.equal(calls, 1);
  assert.equal(result.decision, "no-reported-vulnerabilities");
  assert.deepEqual(result.verifiedNodes, []);
  assert.throws(() => evaluate(report), /exit status/);
});

test("zero findings cannot bypass missing roots, stale sources or incomplete guard evidence", () => {
  const report = zeroReport();
  assert.throws(() => evaluateAudit(report, { status: 0 }), /dependency root/);
  for (const reason of ["installed source hash mismatch", "unexpected installed copies", "postinstall patch is not installed"]) {
    assert.throws(() => evaluate(report, () => { throw new Error(reason); }, { status: 0 }), new RegExp(reason));
  }
  for (const proof of [{ nodes: [] }, { patches: "installed", nodes: [] }, installedProof(clone())]) {
    assert.throws(() => evaluate(report, () => proof, { status: 0 }), /verified node evidence|Unexpected or duplicate/);
  }
});

test("any unknown advisory rejects at every severity even when mixed with known leaves", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const report = clone();
    report.vulnerabilities.braces.via.push({ ...report.vulnerabilities.braces.via[0], source: 12345, severity, url: "https://github.com/advisories/GHSA-unknown-0000-0000" });
    assert.throws(() => evaluate(report), /Unadmitted advisory/);
  }
});

test("exact advisory URL, package identity, severity and range are required", () => {
  for (const mutation of [
    advisory => { advisory.url += "?trusted=true"; },
    advisory => { advisory.name = "expo"; },
    advisory => { advisory.dependency = "expo"; },
    advisory => { advisory.severity = "low"; },
    advisory => { advisory.range = "*"; }
  ]) {
    const report = clone();
    mutation(report.vulnerabilities.braces.via[0]);
    assert.throws(() => evaluate(report), /advisory/i);
  }
});

test("closed cycles and missing via references fail without a package exemption", () => {
  const cyclic = clone();
  cyclic.vulnerabilities.braces.via = ["micromatch"];
  assert.throws(() => evaluate(cyclic), /Unresolved advisory cycle/);
  const orphan = clone();
  orphan.vulnerabilities.braces.via.push("missing-package");
  assert.throws(() => evaluate(orphan), /Missing via reference/);
});

test("empty roots, incomplete schema and inconsistent metadata fail closed", () => {
  for (const mutate of [
    report => { report.auditReportVersion = 1; },
    report => { delete report.metadata; },
    report => { report.metadata.vulnerabilities.total--; },
    report => { report.metadata.vulnerabilities.high--; },
    report => { report.metadata.dependencies.total = -1; },
    report => { delete report.vulnerabilities.braces.nodes; },
    report => { report.vulnerabilities.braces.nodes = []; },
    report => { report.vulnerabilities.braces.nodes = ["../node_modules/braces"]; },
    report => { report.vulnerabilities.braces.via = []; },
    report => { report.vulnerabilities.braces.attestedPatched = true; },
    report => { report.error = { code: "ENOTFOUND" }; }
  ]) {
    const report = clone();
    mutate(report);
    assert.throws(() => evaluate(report));
  }
});

test("unknown process exits, signals, fetch failures and status/count disagreement reject", () => {
  for (const processResult of [
    { status: 0 }, { status: 2 }, { status: null }, { status: 1, signal: "SIGTERM" },
    { status: 1, error: { code: "ETIMEDOUT" } }, { status: 1, stderr: "npm error fetch failed ENOTFOUND" },
    { status: 1, stderr: "npm ERR! audit service error" }
  ]) assert.throws(() => evaluate(clone(), undefined, processResult), /audit.*(?:failed|error|status)/i);
});

test("installed source tampering or disabled postinstall is a verifier failure", () => {
  for (const reason of ["installed source hash mismatch", "postinstall patch is not installed"]) {
    assert.throws(() => evaluate(clone(), () => { throw new Error(reason); }), new RegExp(reason));
  }
  assert.throws(() => evaluate(clone(), () => ({ nodes: installedProof(clone()).nodes })), /no verified node evidence/);
});

test("every nested copy and every propagated package node must have installed evidence", () => {
  const report = clone();
  report.vulnerabilities.braces.nodes.push("node_modules/consumer/node_modules/braces");
  const complete = installedProof(report);
  assert.equal(evaluate(report, () => complete).verifiedNodes.length, 22);
  for (const mutate of [
    proof => { proof.nodes.pop(); },
    proof => { proof.nodes.find(node => node.path.endsWith("consumer/node_modules/braces")).patched = false; },
    proof => { proof.nodes.find(node => node.name === "node-forge").version = "1.3.1"; },
    proof => { proof.nodes.find(node => node.name === "braces").name = "expo"; },
    proof => { proof.nodes.push(proof.nodes[0]); },
    proof => { proof.patches = "installed"; }
  ]) {
    const proof = structuredClone(complete);
    mutate(proof);
    assert.throws(() => evaluate(report, () => proof));
  }
});

const auditArguments = root => ["audit", "--prefix=" + root, "--json", "--include=dev", "--include=optional", "--include=peer", "--workspaces", "--include-workspace-root", "--workspace=apps", "--workspace=packages", "--audit-level=info"];
function cliFixture(t, stdout, { status = 1, stderr = "", proofFailure = null, missingHelper = false, missingVerifier = false, missingAuditVerifier = false, arguments: args = [], config = {}, npmrc = "", workspaces = ["apps/*", "packages/*"] } = {}) {
  const scratch = "/tmp/cplayout-audit-gate-impl";
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tools"));
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "synthetic-test-root", workspaces }));
  fs.writeFileSync(path.join(root, ".npmrc"), npmrc);
  fs.copyFileSync(path.join(__dirname, "dependencyAudit.cjs"), path.join(root, "tools", "dependencyAudit.cjs"));
  fs.writeFileSync(path.join(root, "raw.json"), stdout);
  fs.writeFileSync(path.join(root, "stderr.txt"), stderr);
  let report;
  try { report = JSON.parse(stdout); } catch { report = clone(); }
  fs.writeFileSync(path.join(root, "proof.json"), JSON.stringify(installedProof(report)));
  fs.writeFileSync(path.join(root, "bin", "npm"), "#!" + process.execPath + "\nconst fs=require('node:fs'); if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(" + JSON.stringify(auditArguments(root)) + "))process.exit(99); process.stdout.write(fs.readFileSync('raw.json')); process.stderr.write(fs.readFileSync('stderr.txt')); process.exit(" + status + ");\n", { mode: 0o755 });
  if (!missingHelper) fs.writeFileSync(path.join(root, "tools", "patchDependencySecurity.cjs"), [
    "const fs=require('node:fs'); const path=require('node:path');",
    "exports.patchDependencySecurity=()=>{throw Error('mutation forbidden');};",
    ...(missingVerifier ? [] : [
      "exports.verifyDependencySecurity=root=>{",
      "fs.appendFileSync(path.join(root,'helper-calls.jsonl'),JSON.stringify({method:'verifyDependencySecurity',root})+'\\n');",
      proofFailure ? "throw Error(" + JSON.stringify(proofFailure) + ");" : "return 'already-installed';",
      "};"
    ]),
    ...(missingAuditVerifier ? [] : [
      "exports.checkAuditDependencyNodes=(root,report)=>{",
      "fs.appendFileSync(path.join(root,'helper-calls.jsonl'),JSON.stringify({method:'checkAuditDependencyNodes',root,report})+'\\n');",
      "return JSON.parse(fs.readFileSync(path.join(root,'proof.json'),'utf8'));};"
    ]),
    ""
  ].join("\n"));
  const result = spawnSync(process.execPath, [path.join(root, "tools", "dependencyAudit.cjs"), ...args], { cwd: root, env: { ...process.env, ...config, PATH: path.join(root, "bin") + path.delimiter + process.env.PATH }, encoding: "utf8" });
  const reportDirectory = path.join(root, "reports", "dependency-audit");
  const runs = fs.existsSync(reportDirectory) ? fs.readdirSync(reportDirectory).map(run => path.join(reportDirectory, run)) : [];
  return { root, result, runs };
}

test("CLI retains exact raw bytes, stderr, exit metadata and separately qualified decision", t => {
  const raw = JSON.stringify(captured, null, 2) + "\n\n";
  const { root, result, runs } = cliFixture(t, raw, { stderr: "npm warn synthetic warning\n" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs.length, 1);
  assert.equal(fs.readFileSync(path.join(runs[0], "audit.stdout.json"), "utf8"), raw);
  assert.equal(fs.readFileSync(path.join(runs[0], "audit.stderr.log"), "utf8"), "npm warn synthetic warning\n");
  const metadata = JSON.parse(fs.readFileSync(path.join(runs[0], "process.json"), "utf8"));
  assert.equal(metadata.status, 1);
  assert.deepEqual(metadata.command, ["npm", ...auditArguments(root)]);
  assert.equal(metadata.stdoutSha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(metadata.stdoutBytes, Buffer.byteLength(raw));
  const decision = JSON.parse(fs.readFileSync(path.join(runs[0], "decision.json"), "utf8"));
  assert.equal(decision.rawCounts.high, 21);
  assert.equal(decision.decision, "admitted-local-mitigations");
  assert.match(result.stdout, /Raw npm audit counts.*"high":21/);
});

test("CLI retains mixed raw severity counts when all three exact guards are verified", t => {
  const raw = JSON.stringify(mixedReport());
  const { result, runs } = cliFixture(t, raw);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(runs[0], 'audit.stdout.json'), 'utf8'), raw);
  const decision = JSON.parse(fs.readFileSync(path.join(runs[0], 'decision.json'), 'utf8'));
  assert.deepEqual(decision.rawCounts, { info: 0, low: 0, moderate: 5, high: 21, critical: 0, total: 26 });
  assert.equal(decision.admittedAdvisories.length, 3);
  assert.match(decision.mitigation, /not a zero-audit/);
});

test("CLI verifies installed guards for zero reports and retains their source-check failure", t => {
  const report = zeroReport();
  const raw = JSON.stringify(report) + "\n";
  const { root, result, runs } = cliFixture(t, raw, { status: 0 });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(root, "helper-calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [
    { method: "verifyDependencySecurity", root },
    { method: "checkAuditDependencyNodes", root, report }
  ]);
  const decision = JSON.parse(fs.readFileSync(path.join(runs[0], "decision.json"), "utf8"));
  assert.equal(decision.decision, "no-reported-vulnerabilities");
  assert.deepEqual(decision.verifiedNodes, []);
  const verifiedWithScriptsDisabled = cliFixture(t, raw, { status: 0, config: { npm_config_ignore_scripts: "true" } });
  assert.equal(verifiedWithScriptsDisabled.result.status, 0, verifiedWithScriptsDisabled.result.stderr);
  for (const options of [
    { missingHelper: true }, { missingVerifier: true },
    { missingAuditVerifier: true },
    { proofFailure: "installed source hash mismatch" },
    { proofFailure: "unexpected installed copies" },
    { proofFailure: "postinstall patch is not installed", config: { npm_config_ignore_scripts: "true" } }
  ]) {
    const rejected = cliFixture(t, raw, { status: 0, ...options });
    assert.equal(rejected.result.status, 1);
    assert.equal(fs.readFileSync(path.join(rejected.runs[0], "audit.stdout.json"), "utf8"), raw);
    assert.equal(JSON.parse(fs.readFileSync(path.join(rejected.runs[0], "process.json"), "utf8")).status, 0);
    const rejection = JSON.parse(fs.readFileSync(path.join(rejected.runs[0], "decision.json"), "utf8"));
    assert.equal(rejection.decision, "rejected");
    assert.match(rejection.reason, options.proofFailure ? new RegExp(options.proofFailure) : /Cannot find module|verifier is unavailable/);
  }
});

test("CLI retains invalid JSON and failed-fetch evidence and rejects actual missing patches", t => {
  for (const options of [
    { stdout: "{invalid json" },
    { stdout: JSON.stringify(captured), stderr: "npm error failed to fetch ENOTFOUND\n" },
    { stdout: JSON.stringify(captured), proofFailure: "postinstall patch is not installed" },
    { stdout: JSON.stringify(captured), proofFailure: "installed source tampered" },
    { stdout: JSON.stringify(captured), status: 42 }
  ]) {
    const { stdout, ...processOptions } = options;
    const { result, runs } = cliFixture(t, stdout, processOptions);
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(path.join(runs[0], "audit.stdout.json"), "utf8"), stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runs[0], "decision.json"), "utf8")).decision, "rejected");
  }
});

test("CLI cannot accept arbitrary reports, allowlists, attestation or skip flags", t => {
  for (const argument of ["--skip", "--allow=expo", "--report=raw.json", "--patched=true"]) {
    const { result, runs } = cliFixture(t, JSON.stringify(captured), { arguments: [argument] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /accepts no arguments/);
    assert.equal(runs.length, 0);
  }
});

test("CLI fixes prefix, all dependency categories, workspaces and root despite subset configuration", t => {
  const { root, result, runs } = cliFixture(t, JSON.stringify(captured), { config: { NODE_ENV: "production", npm_config_prefix: "/synthetic-other-prefix", NPM_CONFIG_PREFIX: "/synthetic-uppercase-prefix", npm_config_omit: "dev\noptional\npeer", npm_config_production: "true", npm_config_workspace: "apps/mobile", npm_config_workspaces: "false", npm_config_include_workspace_root: "false", npm_config_audit_level: "none" }, npmrc: "prefix=/synthetic-npmrc-prefix\nworkspace=apps/mobile\nworkspaces=false\ninclude-workspace-root=false\nomit[]=dev\nomit[]=optional\nomit[]=peer\naudit-level=none\n" });
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(fs.readFileSync(path.join(runs[0], "process.json"), "utf8"));
  assert.deepEqual(metadata.command, ["npm", ...auditArguments(root)]);
  assert.equal(metadata.cwd, root);
});

test("unreviewed workspace topology fails before any partial audit can be accepted", t => {
  const { result, runs } = cliFixture(t, JSON.stringify(captured), { workspaces: ["apps/*", "other/*"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown workspace topology/);
  assert.equal(runs.length, 0);
});
