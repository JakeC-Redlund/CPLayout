---
name: cplayout-planning-review
description: Use for CPLayout plans and reviews that must be decision-complete, source-backed, bounded, and explicit about validation, non-goals, and unverified claims.
---

# CPLayout Planning Review

Use this skill when producing or reviewing CPLayout implementation plans.

## Required Plan Shape

- Summary of the decision or implementation direction.
- Scope and non-goals.
- Local facts verified from the worktree, with file paths.
- Source-backed package or platform claims, with primary sources when architecture changes depend on them.
- Files/modules expected to change.
- Data-flow and public-interface impact.
- Native/web verification gates that remain unproven.
- Validation commands and acceptance checks.
- Subagent boundaries only when a subtask is bounded, independent, and does not block the main implementation path.

## Review Rules

- Flag stale references to the old root-level domain/storage layout or nonexistent mobile screen modules unless the text clearly marks them as archived handoff history.
- Flag MapLibre statements that say the dependency must stay uninstalled; the current policy is installed/configured but native-unverified.
- Flag claims that native SQLite, ZIP sharing, native MapLibre, raw PMTiles/MBTiles rendering, or on-device ML are production-ready without device or emulator evidence.
- Flag plans that claim React Native can directly run Python/GDAL/RTKLIB workflows.

## Current workflow record

Use `docs/workflow-registry.json` for requirement IDs, dependencies, owners, source-bound evidence and next action; `docs/development-status.md` is its generated projection. The current owner delegates decisions without further questionnaires. Keep human receipts separate from delegated acceptance, retain failed/deferred evidence and do not reinstate withdrawn AGENTS rules. The relevant maintenance guide defines qualified retirement; source presence, frontmatter/configuration validation and actual runtime remain different capability claims.

The clarified contract is logical Customer → Project → Field folders, actual field machine/map design content and saved Surveys, with official precision Layout maps under the exact matched Survey. Prefer existing IDs/schema/links; no physical folder migration, copied entities or invented document-kind taxonomy. Include empty customers from an authorized customer snapshot. Separate stored-map view/export from fresh owned RTK Fixed creation/live actions, retain manual provenance and historical unqualified maps, and block future ancestor deletion that would orphan retained Survey evidence. Prior R7 browser/R8 bounded results are historical foundations; earlier final-review work cannot accept this new scope or repair an incomplete census retrospectively.

Official V3 creation/finalization/reference history must survive every writer. Refuse any V3 bulk/raw import without original service/workspace/account proof; retain original reads/exports and dedicated same-field reference import without inherited finalization or changed immutable target/Survey links. Plan decisive current receiver admission separately from wall-time tamper checks, and exact measured-station finalization separately from planned targets. Use the registry for changing source/browser/review status so acceptance does not require indexed guide edits after freeze.

Generic Web V3 transitions require current Survey/target/source and the final live owner predicate; new sessions cannot arrive prepopulated/finalized. The current SQLite workspace is V1-only and refuses newer workflows. Scope complete corrective reruns separately from wider failed attempts, HTTP/PostgreSQL source proof separately from an old served App, and current receiver/physical precision separately. Preserve committed server receipts when retired client delivery refuses; do not infer rollback or exactly-once UI behavior.
