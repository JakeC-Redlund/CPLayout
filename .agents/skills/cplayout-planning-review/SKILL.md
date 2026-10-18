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

For hierarchy, Survey/ancestor retention, Layout history and account-admission
planning, read the shared [workflow records guide](../cplayout-workspace-preflight/references/workflow-records.md).
Resolve its relevant requirement IDs in `docs/workflow-registry.json` before
selecting implementation or proof work. Keep historical failed/scoped receipts
exact; a previous review cannot accept new scope or repair an incomplete census.
Do not duplicate current version support, pending fixes or review status here.
