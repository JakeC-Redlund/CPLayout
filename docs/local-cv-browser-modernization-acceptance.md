# Local CV and browser review modernization acceptance

Recorded 2026-09-27T17:37:44.451037+00:00. Derived from canonical CV `records/governance/portable-cv-acceptance.json`, SHA-256 `1f28f04834853a8db72898b090495ac64120a32833119da8c1b98f3df0a0f62a`.

The local review workflow, portable receipt verification, host adapter contracts and ownership-based cleanup are implemented. Canonical geometry and application persistence contracts were not changed by this pass. The shared CV catalog and toolkit live in the canonical CV repository.

## Implemented behavior

- Versioned browser packets import into receipts. Question and figure hashes detect changes; a supplied expected build/capture fingerprint detects mismatches. The supplied value does not independently prove the current build was reviewed. Portable exports include figures, answers, receipt and byte manifest and verify after shutdown.
- Unsent edits, literal comments, revision conflicts, clear-selection controls, keyboard use, focus and status announcements are covered by local tests. Browser access does not establish human authorship.
- Resource leases preserve ownership and failed-stop evidence. Targeted launcher shutdown now verifies process exit and listener release; new static sessions launch Node directly.
- Optional Codex host-only stdio adapter uses generated 0.157.1 schemas and request journals. Its real initialize/exit probe passed; live question turns remain unverified.

## Validation

- `npm run context-map:check`, `npm run validate:skills`, `npm run validate` and both repository diff checks passed.
- `npm run test:visual-review`: **96 passed**, zero failures/skips. `npm audit`: **zero vulnerabilities**.
- `CPLAYOUT_WEB_PROOF_PORT=19019 npm run proof:web`: **703 passed, 10 skipped, one initial mobile test failure**. A stale click location hit an overlay. The final test-only correction passed at desktop, tablet and mobile against the same bundle; the full aggregate was not rerun.
- Local synthetic review screenshots had no page errors or horizontal overflow. Portable export verification passed after the review server stopped. No human questionnaire response was generated.
- Actual launcher recovery and fresh direct-node stop both reached `verified-stopped`, followed by independent process/listener checks. Owned proof and questionnaire resources were closed; unrelated servers were preserved.

The proof bundle hash is `45c4a034ce19da949c9112b73a4f542583741e3ad19db68e3c284395d853a84f`. Other application changes continued in this shared checkout; the browser result is bound to the exported artifact.

## Evidence locations

- Canonical CV: `records/governance/portable-cv-acceptance.json` and `.md`, `portable-cv-skill-catalog.json`, and `records/research-notes/portable-cv-*`.
- Final local portable ZIP in the CV owner: `.cache/portable-cv/final-003/portable-cv.zip`; SHA-256 `2586869679ae63d6e6dde05b8e1a265eca07a04e56b06672de9d1d17c38f71e5`.
- Ignored CPLayout session/log/failure evidence: `.cplayout-local/cv-review-proof-20260927/`. Synthetic screenshots: `.cplayout-local/publication-checkpoint-20260927/reports/cv-modernization-20260927/`.
- [Review lifecycle](interactive-browser-review.md), [cleanup contract](review-resource-cleanup.md), and [optional host adapter](review-host-adapter.md).

Windows Edge human review, fresh host invocation, live Codex requestUserInput lifecycle, full MCP transport, native/device, Google Earth and field behavior remain unverified. Seven newer CV candidates report readiness gaps. No model was promoted and nothing was published or deployed.

Existing work, original failed evidence and superseded benchmark records were preserved. Markdown/JSON remain authoritative; raw captures, OCR, fixture bodies and model assets were not added to shared governance records.
