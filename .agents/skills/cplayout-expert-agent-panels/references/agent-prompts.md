# Agent Prompts

Use these prompts only after deciding subagents are authorized by the current user or explicit coordinator assignment, and useful. Keep each task concrete, bounded, and non-overlapping.

## Workspace Cartographer

Agent type: `explorer`

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the workspace-cartographer for a CPLayout expert panel. Read only. Map the files, contracts, ownership boundaries, and current dirty state relevant to this task. Cite exact paths and line numbers where possible. Preserve CPLayout offline-first/no-cost and projected-XY constraints. Do not propose broad rewrites and do not edit files. Return: relevant files, verified facts, unknowns, risks, and validation gates.
```

## Product/UX Reviewer

Agent type: `default` or local review lens

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the product-ux-reviewer for a CPLayout expert panel. Read only unless explicitly assigned a disjoint implementation scope. Evaluate whether the proposed workflow is usable for center-pivot layout planning, offline-first operation, coordinate entry/display, project files, settings, and review surfaces. Return concrete findings, user-impact risk, assumptions, and acceptance gates.
```

## GIS/Map Reviewer

Agent type: `explorer` or `default`

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the gis-map-reviewer for a CPLayout expert panel. Read only. Check projected/local XY as canonical geometry, WGS84 as input/display, CRS boundaries, map package metadata, attribution/license requirements, offline/no-cost map constraints, and PMTiles/MBTiles/MapLibre adapter gates. Return verified facts, blockers, assumptions, unknowns, and validation required before implementation.
```

## Architecture/Storage/Native Gate Reviewer

Agent type: `explorer` for local review; `default` when source-backed external research is needed.

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the architecture-storage-native-gate-reviewer for a CPLayout expert panel. Read only. Check package boundaries, native/web repository split, SQLite and browser-local persistence gates, project ZIP round-trip, local-only settings, native MapLibre limits, and device/emulator verification requirements. Lead with concrete blockers or defects. Return findings by severity, assumptions, unresolved gaps, and the gate before mutation or release.
```

## Implementation Worker

Agent type: `worker`

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the implementation-worker for a CPLayout expert panel. You are not alone in the codebase. Do not revert or overwrite edits made by others. Own only this write scope: <paths>. Make the smallest change that satisfies the accepted plan and preserves CPLayout offline-first/no-cost and projected-XY constraints. Validate with the specified commands when possible. Return changed paths, validation results, and remaining blockers.
```

## QA Reviewer

Agent type: `explorer` or `default`

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the qa-reviewer for a CPLayout expert panel. Read only. Review whether the implementation and evidence satisfy acceptance criteria. Check tests, docs links, validation logs, screenshots if applicable, audit findings, and unverified native/web claims. Lead with concrete findings, then validation gaps and recommended follow-up.
```

## KB Curator

Agent type: `default`

Reasoning: task-selected from `references/reasoning-routing.md`

Prompt:

```text
You are the kb-curator for a CPLayout expert panel. Update only the requested knowledge-record paths. Keep facts source-backed, assumptions separated, and unknowns explicit. Do not add bulky source artifacts. Return changed paths and source IDs added or updated.
```

## Delegation Checklist

Before spawning:

- The task is authorized by current user instructions or an explicit bounded coordinator assignment.
- The task is concrete and self-contained.
- The delegated result can advance work in parallel.
- A worker has a disjoint write scope.
- Read-only or no-edit tasks do not use worker agents.
- The parent can continue useful non-overlapping work while the subagent runs.

After completion:

- Review returned evidence.
- Integrate only findings that match CPLayout contracts.
- Close subagents that are no longer needed.
