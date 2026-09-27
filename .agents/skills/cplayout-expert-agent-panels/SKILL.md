---
name: cplayout-expert-agent-panels
description: Use when the user says "Implement expert agent panels" or asks for CPLayout expert-agent panel review, continuous improvement loops, specialist teams, multi-agent implementation or review, source-backed research, validation triage, or knowledge-record updates.
---

# CPLayout Expert Agent Panels

## Core Rule

Run CPLayout expert panels as evidence-first coordination loops. The main agent remains coordinator, owns the critical path, preserves unrelated dirty work, and keeps verified facts, assumptions, unknowns, recommended actions, validation gates, and knowledge-record updates separate.

Direct user no-mutation instructions win over this workflow. For read-only tasks, do not implement or update records; list the records that would need updates instead.

## Quick Start

1. Re-read `AGENTS.md` and `docs/agent-tree-protocol.md`, then run `git status --short` and preserve pre-existing changes.
2. Load repo-local skills that match the task:
   - `.agents/skills/cplayout-workspace-preflight/` for repository and validation gates.
   - `.agents/skills/cplayout-planning-review/` for bounded, source-backed plans.
3. Inventory available skills when the user asks for all skills, when routing is ambiguous, or when the panel task depends on skill selection.
4. Classify the task by risk, owner role, mutation scope, external evidence need, and validation gate.
5. Close local knowledge gaps first, then research current external facts from official or primary sources.
   - For CPLayout Google Earth/KML loops, re-check the Google KML Reference, Google shared-style tutorial, OGC KML page, and the repo source ledger before changing import/export behavior.
6. Use `references/prompt-triage.md` when the prompt needs specialist routing, new agent surfaces, hooks, skills, source ledgers, or knowledge-record updates.
7. Select bounded subagents when independent evidence, review, or disjoint implementation is useful under the owner's standing authorization. A hook match alone is not a spawn decision. If a useful leaf cannot run, record `Accepted fallback:` with the reason.
8. Synthesize the panel result into the next concrete action, implement only when mutation is allowed, validate, and record durable findings when appropriate.

For the detailed sequence, read `references/panel-lifecycle.md`.

## Specialist Roles

Use these roles as prompted subagents when useful, or as local review lenses when subagents are unavailable or a bounded parallel task would not help:

| Role | Agent type | Reasoning | Purpose |
| --- | --- | --- | --- |
| `workspace-cartographer` | `explorer` | task-selected | Map files, contracts, dirty state, and ownership boundaries. |
| `product-ux-reviewer` | `default` or local lens | task-selected | Check CPLayout workflow usability and visible acceptance risks. |
| `gis-map-reviewer` | `explorer` or `default` | task-selected | Check projected `XY` geometry, WGS84 input/display separation, map packages, attribution, and offline/no-cost boundaries. |
| `architecture-storage-native-gate-reviewer` | `explorer` or `default` | task-selected | Check repository split, SQLite/web/native gates, ZIP archive flow, and unverified native claims. |
| `implementation-worker` | `worker` | task-selected | Make a bounded change in a disjoint write scope after mutation is allowed. |
| `qa-reviewer` | `explorer` or `default` | task-selected | Review tests, validation evidence, screenshots, audit findings, and residual risk. |
| `kb-curator` | `default` | task-selected | Update source ledgers, task logs, prompt registry, docs index, and known gaps. |

For role prompts and delegation rules, read `references/agent-prompts.md`.

## Subagent Boundary

Treat non-trivial CPLayout panel, review, implementation, validation, and knowledge-curation work as standing authorization to spawn bounded subagents when the runtime permits it and independent scope adds value. Decompose broad work at the coordinator before spawning.

Use built-in agents for generic exploration and implementation:

- `explorer` for workspace mapping, code review, and validation triage.
- `default` for source-backed external research or synthesis.
- `worker` only for disjoint implementation slices after mutation is allowed.

Project-scoped `.codex/agents/*.toml` specialists are allowed under the standing CPLayout authorization when a repeated workflow justifies the maintenance cost. Keep those agents narrow, source-backed, and read-only by default; use `worker` only for explicit bounded mutation scopes.

Keep immediate blocking work local. Wait for subagents only when their result is needed for the next critical-path decision.

## CPLayout Constraints

Every panel must preserve these boundaries:

- Keep the app free/no-cost and offline-first.
- Do not add Google Maps, paid Mapbox APIs, Esri paid services, paid imagery, paid cloud backends, hidden API keys, or trial-only SDKs.
- Keep canonical geometry as projected/local `XY`; WGS84 is input/display unless a schema change explicitly says otherwise.
- Do not claim React Native can directly run Python GIS packages.
- Use Expo-installed native dependencies when an Expo SDK package is available.
- Keep native SQLite, ZIP sharing, native MapLibre, and raw PMTiles/MBTiles rendering behind documented device/emulator verification gates.
- Keep drawing viewport state separate from geometry mutation.
- Treat KML/KMZ styling as visual interchange only: do not let `Style`, `LineStyle`, `PolyStyle`, `IconStyle`, `LabelStyle`, or `styleUrl` alter canonical projected `XY`, SQLite/web persistence, CPLayout archives, or native runtime claims.

## Reasoning Defaults

Load `references/reasoning-routing.md` when a task spans architecture, storage, maps, native behavior, or release gates. Short form:

- Record the complexity band and selected reasoning effort before mutation.
- Use `xhigh` for native/runtime proof, architecture, storage contracts, release gates, managed Codex policy, Google Earth proof, broad cross-module mutation, or unresolved reviewer disagreement.
- Use lower reasoning bands for narrower work when the task analysis supports them.

## Evidence And Records

Load `references/evidence-and-records.md` when the panel needs source ledgers, known-gap tables, task logs, prompt registry entries, or current external research. For OpenAI and Codex facts, use OpenAI docs MCP tools first; fallback browsing must stay on official OpenAI domains.

## Done Criteria

The panel loop is complete when:

- verified facts, assumptions, and unknowns are explicit,
- relevant skills and sources were inventoried or cited,
- required implementation is complete when mutation is allowed,
- validation commands have run or blockers are recorded,
- KML/KMZ loops record artifact paths, SHA-256 hashes, browser screenshots when available, and native/Google Earth proof caveats,
- durable records are updated or explicitly skipped because the task is read-only,
- unrelated user or pre-existing changes were preserved.
