# Dependency security mitigations

Updated 2026-10-06. A fresh isolated install, installed-source checks and 45 focused
checks pass. The qualified audit gate passes; aggregate/browser verification and
complete acceptance remain pending. This record does not claim a zero raw audit result.

The current raw npm audit reports **21 high and five moderate findings**, rooted
in three advisories. Their transitive parents are included in that count. The
installed versions are `braces@3.0.3`, `node-forge@1.4.0` and `sprintf-js@1.0.3`;
those current registry/advisory records provide no published patched release. The registry's force-fix proposals change
Expo/React Native and do not establish a repair compatible with the current SDK.

Primary references checked today:

- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
  [upstream depth issue](https://github.com/micromatch/braces/issues/70).
- [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and
  [open upstream defensive validation change](https://github.com/digitalbazaar/forge/pull/1152).
- [sprintf precision advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
  and [upstream disclosure](https://github.com/alexei/sprintf.js/issues/237).
- [source-map advisory and published fix](https://github.com/advisories/GHSA-68fv-2mgg-jv7q):
  `source-map-js@1.2.2` replaces 1.2.1 within the existing PostCSS `^1.2.1` range.
  This finding is repaired by the upstream release and is never admitted by the
  local mitigation policy.
- [shell-quote advisory and published fix](https://github.com/advisories/GHSA-pqg4-j6r4-53mv):
  version 1.12.0 replaces 1.10.0 within the existing React DevTools 1.x range.
  The newly reported critical finding remains outside local mitigation admission.
- Registry records: [braces](https://registry.npmjs.org/braces),
  [node-forge](https://registry.npmjs.org/node-forge).

The selected compatible path pins those exact existing versions and applies
reviewed local defensive validation patches during postinstall. The source-map
package is separately pinned to its compatible upstream fixed release. The braces guard
bounds combined brace/parenthesis parsing and validates AST child depth, cycles
and parent chains before recursive walkers, including direct library entry points.
The node-forge guard validates the complete algorithm-identifier envelope: only
the expected identifier and optional empty parameter value are permitted.
Ordinary supported algorithms and existing parameter requirements remain intact.
The sprintf guard bounds numeric precision before native formatting: exponential
and fixed formatting use 0–100 digits, general formatting 1–100. Omitted/legal
format precision and argparse output remain compatible. Excess precision clamps
instead of invoking a native method with an out-of-range argument; zero general
precision becomes one. Direct AST calls are covered, without changing arguments,
parse trees or cached patterns. Width, user callbacks and every possible
formatting resource cost are outside this narrow precision mitigation.

These are narrow mitigations of the named findings, not a general security
certification or proof that every resource-exhaustion case has been removed.

Patch manifests bind package versions, patch bytes, original and installed file
hashes, added files and real consumer resolution. Installation preflights every
target before mutation, refuses partial or unfamiliar baselines, and is idempotent.
Check-only verification refuses unpatched or altered installed files and
unexpected copies. Existing SQLite and xcode patches retain their own contracts.

`npm run audit:verified` runs a fresh complete audit and archives the exact raw
stdout, stderr and process outcome under `reports/dependency-audit/`. It keeps raw
findings visible and reports the separate mitigation decision. It validates the
report schema, totals, installed node paths and every dependency-to-advisory chain.
Legitimate dependency cycles may reach advisory leaves; unresolved or missing
references refuse admission. Only the three exact advisory identities above may be
recognized, after their exact installed dependency source has been verified.
Unknown advisories of any severity, omitted or invalid evidence, fetch failures,
changed versions, unpatched copies and disabled installation repairs fail closed.
There is no package-wide exemption or argument to suppress a finding.

The command explicitly fixes the repository prefix, dependency categories and
all workspace parents/root. Even a zero-finding report must verify the current
installed guards and node evidence; omission configuration or a foreign prefix
cannot bypass those checks.

The source CI retains this raw evidence and requires the separate installed-source
verification gate, source tests and every browser shard. Raw `npm audit` remains
a required reported result; local mitigation does not change its severity counts.
Historical zero-audit reports describe their original dated executions.

Before admission: patch-install refusal/idempotence/tamper tests, meaningful parser
bounds and ordinary compatibility checks, installed consumer/source verification,
an isolated clean install, full source/export/browser gates, and independent
review are required. The independent cryptographic review turn was stopped by the
execution tool's cybersecurity filter; its completed scoped evidence is retained,
and the unfinished review does not constitute clearance. Further acceptance must
follow supported defensive source and validation evidence.

Remove these local mitigations through a reviewed upgrade when compatible
upstream patched releases become available. Recheck package versions, changes to
the advisory scope and all source/compatibility gates; do not silently update
manifest hashes to accept a changed dependency. No physical receiver, native, OEM
or measured field-accuracy qualification follows from these checks.
