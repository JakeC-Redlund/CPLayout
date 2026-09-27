# Draft Repository Evidence

2026-09-25 historical working-tree checkpoint; no commit or push occurred in this packet. Its source manifest does not identify the later combined worktree. This advances the full refactor's incomplete-design storage contract, not its UI/native/field acceptance.

## Scope

Strict draft create/save/delete commands; mixed discriminated catalog and design reads; unchanged legacy document bytes; workspace/design revision protection; detached inputs and receipts. No new storage schema, package, invented geometry, automatic promotion or native adapter is introduced. See [the contract record](../../draft-catalog-implementation.md#draft-repository-commands-2026-09-25).

## Validation

The corrected focused command/adapter suite passed 59 cases. An earlier `npm run validate` and fresh Expo web export reported exit 0, and 30 selected browser cases passed in 48.51 seconds, ten per viewport, with zero failures, skips, retries, flaky cases or runner errors. Those aggregate/browser/export runs preceded or overlapped the later optional-field correction, so they do not establish corrected-source browser or aggregate acceptance. Three browser cases exercised the draft repository harness and 27 exercised legacy App activation. The packet's root audit reported zero vulnerabilities; skill/context validation and whitespace checks passed. This is not complete product browser coverage.

[Build identity](identity.json) records unchanged HEAD `ec050f60bf515b5c4cbd40c3180615b5056e28b3` and 316 frozen source paths for its recorded checkpoint, not the later optional-field correction or current combined tree. Local and served App bundle SHA-256 for that checkpoint both equal `95ae9ebee6f38a63e0aba410f16e1bcf4f0b4c5c5e1bb6c5610d85b5fabc7a97`. The [source manifest](source.json), [aggregate log](validate.log), [focused tests](focused-corrected.log), [browser report](browser-final.json), [export log](export.log), [audit](audit.json) and [skill validation](skills-final.log) are retained. Source hashing covers only the listed application/test/config paths at their recorded times.

Inspected screenshots retain the [phone stale-save warning](phone-stale-save.png) and [desktop opaque recovery](desktop-recovery.png) with synthetic data. They establish those visible states, not complete workspace visual acceptance or an incomplete-design editor. The rejected/superseded attempts were written under `/tmp/cplayout-draft-repository-20260925-FobNDl/`, which was absent during the 2026-09-26 publication review and is not retained evidence.

Focused adapter tests passed 21 cases. The first run failed one test that matched error wording rather than the stable `not_found` code; the assertion was corrected to check the error class/code, preserving the unchanged-data checks. A pre-final repository browser harness passed three viewport cases. The final frozen-source repeat and legacy App regression selection are reported above.

Independent review then reproduced rejection of valid known optional `undefined` draft fields by the legacy command retention check. The strict core draft parser already rejects unknown fields and intentionally omits known optional undefined values. Only draft create/save now rely on that parser's retention contract; legacy project commands retain their additional check. The new regression covers create/save with untouched default settings and omitted machine/map-feature fields, while unknown undefined fields still reject. The corrected focused suite passes 59 cases. Earlier 30-case browser success and export are historical pre-correction evidence, not final acceptance; no `before-optional` directory is present in this packet. The first aggregate overlapped this correction and cannot establish a frozen-source pass, regardless of its exit status.

The independent reviewer re-ran the original reproduction after correction: four valid cases accepted, 18 malformed cases rejected, zero getter executions, and four targeted command tests passed. No remaining scoped finding was reported. This is source-level review, not independent browser or hardware acceptance. Raw custom store transitions remain lower-level primitives; only the command boundary promises these ownership/CRS/revision semantics.

```sh
npm run validate
npm run export:web
CPLAYOUT_WEB_PROOF_PORT=19014 npx playwright test tests/web/workspace-drafts.spec.ts tests/web/workspace-activation.spec.ts --workers=2
npm audit --json
npm run validate:skills
npm run context-map:check
git diff --check
```

The browser harness uses the current bundled repository module with real `navigator.locks` and localStorage on the exact repo-owned origin `http://127.0.0.1:19014`; it is not an App draft-editor test. Its bundled-source hash is attached to each test result. Existing activation cases exercise the exported App. The preview remains deliberately available for user review; unrelated listeners are untouched.

## Limits

At this checkpoint, the App still used its project-only editor/catalog and did not expose these draft commands. It needed discriminated state and incomplete geometry without a fabricated full project before drafts could be activated for users. A low-level custom store transition is not a substitute for the validated repository commands. Arbitrary JavaScript objects are not trusted workspace input; repository reads parse the stored JSON envelope. Native SQLite/MapLibre, archive-sharing runtime, receiver/relay/radio operation and strictly-below-0.10-m maximum 3D error were not proven by this packet. The broader goal remained active and incomplete at this checkpoint.
