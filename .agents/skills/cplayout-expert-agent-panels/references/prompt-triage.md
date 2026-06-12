# CPLayout Prompt Triage

Use this reference when a prompt asks for specialist routing, agent panels, source-backed research, or workspace-wide process improvement.

## Default Routing

| Prompt signal | Primary skill | Specialist agent | Secondary coordination |
| --- | --- | --- | --- |
| Google Earth, KML/KMZ, visual proof, imagery, OCR/CV, field boundary | `$cplayout-imagery-mapping-agent` | `cplayout_imagery_mapper` | Pivot design, database, UI as needed |
| Interface, screen, component, map surface, map visual overlays, right sidebar/drawer, toolbar, UI-proof, Expo, Playwright evidence, UI test server, local web launcher | `$cplayout-interface-development-agent` | `cplayout_interface_developer` | Database and pivot design as needed |
| Center pivot, lateral or linear move, corner arm, wheel/tower tracks, end-of-machine paths, irrigation scoring | `$cplayout-center-pivot-design-agent` | `cplayout_center_pivot_designer` | Imagery and database as needed |
| SQLite, project-store, archive, schema, CRUD, migration | `$cplayout-database-agent` | `cplayout_database_specialist` | Interface and pivot design as needed |
| Skills, agents, hooks, route keywords, governance keywords, source ledger, known gaps, prompt registry | `$cplayout-expert-agent-panels` | `cplayout_kb_curator` | Planning review as needed |

## Decision Rules

- Start non-trivial work with `AGENTS.md` and `git status --short`.
- Prefer local repo evidence before memory and external research.
- Use current official or primary sources for package, platform, Codex, Google Earth, database, and engineering claims.
- Keep project-local hooks advisory. They add routing context but do not enforce policy or prove behavior unless installed through managed `requirements.toml` and verified after restart.
- Treat managed-hook planning as a Codex policy task: separate local repo facts from official OpenAI docs and record trust, restart, and runtime-verification gaps.
- Keep custom agents read-only unless the coordinator assigns a bounded mutation scope to a worker.
- Keep projected/local `XY` canonical geometry separate from WGS84 display/input, KML/KMZ styling, imagery evidence, and operator labels.
- For local browser UI server launches, use repo-owned launcher commands instead of ad hoc servers: `npm run ui:test:start -- --no-open`, `npm run ui:test:status`, `npm run ui:test:stop`, or `npm run dev:web:smart` when live reload is specifically needed. Report the exact printed URL and cleanup status.

## Coordinator Contract

The `UserPromptSubmit` hook should emit a compact contract for non-trivial prompts:

- matched specialist routes with route id, configured agent, score, coordinator complexity band, coordinator reasoning effort, task-selected subagent reasoning guidance, spawn policy, and routing reason,
- required preflight: re-read `AGENTS.md`, run `git status --short`, and preserve unrelated dirty work,
- auditable subagent decision: `required`, `optional`, or `not useful`, with a short reason,
- coordinator complexity band and coordinator reasoning effort from route metadata when a route matches,
- per-subagent effort selected from each delegated task, not inherited automatically from the coordinator route band,
- no hidden global fallback: if no route or clear complexity signal exists, emit `complexity analysis required before mutation`,
- optimized re-prompt that preserves CPLayout no-cost/offline-first, projected/local `XY`, and evidence-only KML/KMZ/imagery boundaries,
- validation expectations merged from base hook checks and matched routes.

Route matching should be token/phrase-aware rather than raw substring matching so broad words such as `agent`, `hook`, `layout`, or `web` do not match inside unrelated words or route by themselves.

Complexity bands:

- `xhigh`: CPLayout architecture, managed policy, storage/native/runtime claims, Google Earth proof, release gates, multi-package mutation, and process enforcement. Treat route-data `xhigh` as coordinator guidance; subagents still get task-selected effort in their own prompt.
- `high`: hook, skill, and agent implementation or review.
- `medium`: fixture-only route tests, docs-only registry updates, and bounded read-only scans.
- `low`: trivial status or formatting only when the user explicitly requests a narrow low-effort task.

Subagent decision rules:

- `required`: the user explicitly asks for multi-agent, subagent, panel, parallel-agent, delegation, or specialist-team work, or the prompt is non-trivial CPLayout work with matched specialist routes under the owner's standing authorization.
- `optional`: a trivial or narrow prompt matched a specialist but the coordinator can show that spawning would not add useful independent evidence.
- `not useful`: no specialist route matched and coordinator-only preflight is enough.

## Stop Hook

The project-local `Stop` continuation hook is disabled. `.codex/hooks.json` does not register `Stop`, and `.codex/hooks/cplayout_stop_multi_agent.py` is a compatibility no-op for already-loaded command references. Missing subagent accounting should be corrected through the normal coordinator contract, not by automatic Stop continuation prompts.

## Validation

- For skill, hook, and agent surface changes, run `npm run validate:skills`, TOML/JSON parsing, hook sample execution, `git diff --check`, and `npm audit`.
- For TypeScript or UI changes, also run `npm run validate`.
- For visible UI changes, run `npm run ui:test:start -- --no-open` for local static-export checks and capture Playwright evidence from the exact printed URL when available. Use `npm run proof:web` for deterministic browser proof.
