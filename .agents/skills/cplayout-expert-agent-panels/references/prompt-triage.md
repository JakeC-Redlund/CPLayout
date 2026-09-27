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

- Start non-trivial work with `AGENTS.md`, `docs/agent-tree-protocol.md`, and `git status --short`.
- Prefer local repo evidence before memory and external research.
- Use current official or primary sources for package, platform, Codex, Google Earth, database, and engineering claims.
- Keep project-local hooks advisory. They add routing context but do not enforce policy or prove behavior unless installed through managed `requirements.toml` and verified after restart.
- Treat managed-hook planning as a Codex policy task: separate local repo facts from official OpenAI docs and record trust, restart, and runtime-verification gaps.
- Keep custom agents read-only unless the coordinator assigns a bounded mutation scope to a worker.
- Keep projected/local `XY` canonical geometry separate from WGS84 display/input, KML/KMZ styling, imagery evidence, and operator labels.
- For local browser UI server launches, use repo-owned launcher commands instead of ad hoc servers: `npm run ui:test:start -- --no-open`, `npm run ui:test:status`, `npm run ui:test:stop`, or `npm run dev:web:smart` when live reload is specifically needed. Report the exact printed URL and cleanup status.

## Coordinator Contract

The `UserPromptSubmit` hook should emit at most three advisory route IDs, a task-selected first-read reference, and a compact reminder to apply `AGENTS.md`/the tree protocol. The whole `additionalContext` should remain within its tested byte cap. It must not repeat the prompt, concatenate route paragraphs, or pretend to change an active model setting. Match results guide the coordinator's own complexity/effort/subagent decision; each delegated leaf gets a separate task-selected effort and bounded ownership packet. No route is a normal outcome, not permission to skip preflight. Explicit multi-agent requests still need a decision, while explicit no-delegation instructions win.

Route matching should be token/phrase-aware rather than raw substring matching so broad words such as `agent`, `hook`, `layout`, or `web` do not match inside unrelated words or route by themselves.

Complexity bands:

- `xhigh`: CPLayout architecture, managed policy, storage/native/runtime claims, Google Earth proof, release gates, multi-package mutation, and process enforcement. Treat route-data `xhigh` as coordinator guidance; subagents still get task-selected effort in their own prompt.
- `high`: hook, skill, and agent implementation or review.
- `medium`: fixture-only route tests, docs-only registry updates, and bounded read-only scans.
- `low`: trivial status or formatting only when the user explicitly requests a narrow low-effort task.

Subagent decision rules:

- `required`: the user explicitly asks for delegation or independent scopes/QA materially reduce risk under the owner's standing authorization.
- `optional`: a bounded independent task might help, but the coordinator can continue and compare its cost with the expected evidence value.
- `not useful`: a trivial/coupled task has no useful independent leaf, or the user explicitly restricts delegation.

## Stop Hook

The project-local `Stop` continuation hook is disabled. `.codex/hooks.json` does not register `Stop`, and `.codex/hooks/cplayout_stop_multi_agent.py` is a compatibility no-op for already-loaded command references. Missing subagent accounting should be corrected through the normal coordinator contract, not by automatic Stop continuation prompts.

## Validation

- For skill, hook, and agent surface changes, run `npm run validate:skills`, TOML/JSON parsing, hook sample execution, `git diff --check`, and `npm audit`.
- For TypeScript or UI changes, also run `npm run validate`.
- For visible UI changes, run `npm run ui:test:start -- --no-open` for local static-export checks and capture Playwright evidence from the exact printed URL when available. Use `npm run proof:web` for deterministic browser proof.
