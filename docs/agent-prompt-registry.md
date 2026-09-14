# CPLayout Agent Prompt Registry

This registry records the repo-local specialist prompt surfaces and the session-level skill inventory that informed them. Verify the active Codex skill list in each future session before relying on this snapshot.

## Repo-Local Skills

| Skill | Purpose | Primary owner |
| --- | --- | --- |
| `$cplayout-workspace-preflight` | CPLayout preflight, dirty-tree inspection, validation gate selection | Coordinator |
| `$cplayout-planning-review` | Decision-complete, source-backed plans and reviews | Coordinator, curator |
| `$cplayout-expert-agent-panels` | Specialist panels, source-backed synthesis, records, validation triage | Coordinator, curator |
| `$cplayout-google-earth-imagery-analysis` | Google Earth Pro imagery, KML/KMZ evidence, local OCR/CV planning | Imagery mapper |
| `$cplayout-imagery-mapping-agent` | Imagery-assisted boundary and pivot-layout evidence workflows | Imagery mapper |
| `$cplayout-interface-development-agent` | Expo UI/UX, interface workflows, visible verification | Interface developer |
| `$cplayout-center-pivot-design-agent` | Center pivot, lateral move, and corner-arm advisory design review | Pivot designer |
| `$cplayout-database-agent` | SQLite, project-store, archive, migration, CRUD review | Database specialist |
| `$cplayout-runtime-proof-gate-agent` | Native/runtime proof, release gates, production-readiness claim review | Runtime proof gatekeeper |
| `$cplayout-gis-geometry-guard-agent` | Projected/local XY, CRS, WGS84 display/input, coordinate transforms, tile package boundaries | GIS geometry guardian |
| `$cplayout-qa-validation-agent` | Validation triage, acceptance gates, proof gates, audit findings, regression evidence | QA validation reviewer |

## Custom Codex Agents

| Agent | Default mode | Use when | Config |
| --- | --- | --- | --- |
| `cplayout_imagery_mapper` | Read-only | Imagery, KML/KMZ, CV, operator boundary, Google Earth visual evidence | `.codex/agents/cplayout_imagery_mapper.toml` |
| `cplayout_interface_developer` | Read-only | Interface, Expo, screen, component, web/native UI verification | `.codex/agents/cplayout_interface_developer.toml` |
| `cplayout_center_pivot_designer` | Read-only | Pivot, lateral move, linear move, corner arm, design scoring | `.codex/agents/cplayout_center_pivot_designer.toml` |
| `cplayout_database_specialist` | Read-only | SQLite, project-store, schema, archive, migration, CRUD | `.codex/agents/cplayout_database_specialist.toml` |
| `cplayout_kb_curator` | Read-only | Source ledgers, prompt registry, known gaps, durable guidance | `.codex/agents/cplayout_kb_curator.toml` |
| `cplayout_runtime_proof_gatekeeper` | Read-only | Native proof, Android/iOS verification, GNSS/RTK field reports, MapLibre proof, SQLite/ZIP proof, Google Earth render proof, release gates | `.codex/agents/cplayout_runtime_proof_gatekeeper.toml` |
| `cplayout_gis_geometry_guardian` | Read-only | Projected/local XY, CRS, WGS84 input/display, coordinate transforms, map package attribution, PMTiles/MBTiles/TileJSON boundaries | `.codex/agents/cplayout_gis_geometry_guardian.toml` |
| `cplayout_qa_validation_reviewer` | Read-only | Validation triage, acceptance gates, test gaps, proof gates, audit findings, regression and release evidence | `.codex/agents/cplayout_qa_validation_reviewer.toml` |

## Prompt Triage

Prompt triage is implemented as an advisory `UserPromptSubmit` hook in `.codex/hooks.json`, backed by `.codex/hooks/cplayout_prompt_triage.py`, `.codex/hooks/cplayout_route_data.json`, and `.codex/hooks/cplayout_context_map.json`. It injects routing and compact context-reference metadata only; it does not enforce policy or prove runtime behavior.

The 2026-09-13 workflow packet adds explicit no-delegation precedence, shell-payload-only guard matching, finite/nonnegative panel weights and broader governance input hashes. Negation handling is a tested phrase heuristic, not complete instruction interpretation. Managed loading does not make mutable checkout policy inputs trusted or prove complete tool coverage. See [mapping-workflow-review.md](mapping-workflow-review.md) for execution scope and unfinished governance work.

The route data uses token/phrase-aware weighted positive and negative keywords. A route score is the sum of matched positive weights minus matched negative weights. Routes are emitted only when their score is at least `minScore`, then sorted by score descending, route priority ascending, and route id. Hook output is capped by `maxRoutes`, currently `3`, so broad prompts do not flood the context window with every specialist.

Every route declares `agent`, `complexityBand`, coordinator `reasoningEffort`, `subagentReasoningEffort`, `spawnPolicy`, `routingReason`, and `validationExpectations`. The hook emits a coordinator contract with matched specialists, required preflight, subagent decision (`required`, `optional`, or `not useful`), coordinator complexity band, coordinator reasoning effort, task-selected subagent reasoning guidance, optimized re-prompt, and validation expectations. Route data intentionally has no global default complexity or reasoning effort; when no route or clear complexity signal matches, the hook emits `complexity analysis required before mutation`.

Broad terms such as `agent`, `hook`, `layout`, and `web` are intentionally low weight. They should not route by themselves; they only help rank a route when stronger task-specific terms are also present.

Token-efficiency guardrails are enforced in both hook code and validation. Prompt triage emits no more than three matched routes, context-pack hook summaries respect `maxEmittedPackSummaryChars` from `.codex/hooks/cplayout_context_map.json` (currently `1200` characters for the context-pack section), generated route and agent context refs stay within `maxContextPacksPerHook`, each pack stays within `maxContextPackTokenBudget`, and `tools/validate_cplayout_skills.py` caps the curator positive-keyword surface so governance routing cannot expand indefinitely without an explicit budget decision. Route wording changes should add or update fixture tests instead of relying on broad standalone keywords.

## Generated Context Map

`tools/build_cplayout_context_map.py` generates `.codex/hooks/cplayout_context_map.json`, `docs/agent-context-map.md`, and `docs/agent-governance-summary.md`. The map gives each route and custom agent compact context-pack ids, minimum-read paths, secondary-read paths, validation commands, expected output shape, token budgets, panel weights, and hard vetoes. The Markdown exposes pack `tokenBudget` values for human budget review. It does not include raw file content, ignored reports, local customer artifacts, secrets, absolute machine paths, or extracted PDF bodies.

The prompt triage hook preserves existing route scoring, then emits at most three context packs for matched routes and trims context-pack detail before it can exceed the context-map summary budget. The subagent-start hook emits matching agent context packs when a custom CPLayout agent starts. If the context map is missing or invalid, hooks fail open and keep the ordinary coordinator or subagent boundary text.

Run `npm run context-map:build` after changing routes, hooks, custom agents, repo-local skills, validation records, or indexed docs. Run `npm run context-map:check` or `npm run validate:skills` before reporting success; the check fails when the checked-in JSON or Markdown is stale.

## Persistent Subagent Authorization

The CPLayout owner has persistently requested and authorized bounded subagent use for non-trivial CPLayout planning, review, implementation, validation, and knowledge-curation work. Future coordinators should state `Subagent decision: required/optional/not useful` in their summary, spawn bounded read-only or worker subagents when runtime tools are available and scopes are independent, and record `Accepted fallback:` when subagent tools are unavailable or would not add independent evidence. Each subagent gets its own task-selected reasoning level, read/write scope, expected output shape, and no-overlap boundary; a coordinator `xhigh` route band is not automatic effort inheritance. This authorization does not remove the coordinator's duty to keep the main agent on the critical path, avoid overlapping write scopes, and verify all facts directly.

HUD-first, right-sidebar, right-drawer, toolbar, UI-proof, map workspace, map visual overlay, UI test server, local web launcher, and Will Rhea / Jason Harmelink advisory-demo prompts route through the interface developer and imagery mapper when they include terms such as `HUD`, `bottom HUD`, `right-sidebar`, `right-drawer`, `toolbar`, `UI-proof`, `map workspace`, `map visual elements`, `ui:test:start`, `ui:test:status`, `ui:test:stop`, `dev:web:smart`, `local web launcher`, `UI test server`, `wheel track overlay`, `end-of-machine indicator`, `Will Rhea`, or `Jason Harmelink`. For local browser checks, agents should use the repo-owned launcher commands, report the exact printed URL, and clean up with `npm run ui:test:stop`; broad standalone words like `server` or `web` should not route by themselves. Add the center-pivot designer and database specialist only when the prompt also asks for advisory design scoring, wheel/tower tracks, end-of-machine paths, generated review zones, persistence, ZIP archive, SQLite, or schema behavior. Add the KB curator when the prompt asks for known gaps, source ledgers, prompt registry, context-map, or plan-record updates involving Will Rhea/client KMZ evidence. Generated Will Rhea overlays remain advisory and projected/local `XY`; KMZ-derived evidence keeps provenance and does not become Google Earth render proof.

ML/CV pivot-locating prompts route through the imagery mapper, center pivot designer, and KB curator when they include terms such as `pivot center detection`, `automatic pivot locating`, `TRUE_PIVOT_CENTER`, `Hough circle`, `radial alignment`, `machine learning`, `100 iteration`, or `weighted vote`. This keeps automatic center-pivot locating work tied to imagery evidence, design plausibility, source records, and the no-automatic-geometry-mutation boundary.

Offline aerial imagery package prompts route through the imagery mapper, interface developer, database specialist, and KB curator when they include terms such as `NAIP`, `USGS TNM`, `ImageryOnly`, `free aerial imagery`, `offline aerial package`, `RasterSource`, `TileJSON`, `GDAL`, `map package import`, or `cplayout-map-package-v1`. This keeps source policy, UI controls, project-store archive/schema work, and native proof checklists aligned. React Native runtime GDAL/Python claims, public live tile caching, raw PMTiles/MBTiles production claims, and paid/keyed imagery remain out of scope unless a separate source-backed adapter/proof task changes that boundary.

CornerGPSMap, BPF, LRDU/SDU, safety-zone, tire, RPM, corner-angle, extension, and retraction prompts route through the imagery mapper, interface developer, center-pivot designer, and KB curator when they include terms such as `CornerGPSMap`, `GPSMap`, `BPF`, `Boundary Point File`, `KMLtoBPF`, `GGS`, `VRI`, `corner arm map`, `LRDU/SDU path`, `LRDU`, `SDU`, `safety zone`, `drive unit tire`, `tire option`, `motor RPM`, `corner angle`, `steer angle`, `corner arm extension`, or `corner arm retraction`. These prompts require source-backed local evidence, projected/local `XY` import gates, synthetic/redacted fixtures, no vendor binary reverse engineering, no broad standalone `angle`/`extension`/`retraction` over-routing, and no controller/export compatibility claim unless separately proved.

Corner-arm scaffold artifact prompts route through `cplayout_center_pivot_designer` plus `cplayout_kb_curator` when they include terms such as `corner arm scaffold`, `Valley Corner Arm Specs`, `normalized spec`, `pivot_center_to_lrdu_radius`, `LRDU speed`, `extension/retraction-aware path`, `physical swept envelope`, or `wetted/application envelope`. Add the interface developer only when the prompt asks for visible workflow controls, and add database only when scaffold metadata becomes persisted project data. These prompts must preserve source hashes, `production_ready=No`, projected/local `XY`, physical-vs-wetted separation, and no proprietary/controller proof claims.

Google Earth-inspired companion workflow and onboarding prompts route through the imagery mapper, KB curator, and interface developer when they include terms such as `Google Earth-inspired`, `Google Earth companion`, `companion evidence`, `map imagery organization`, `import wizard`, `Places/Layers`, `help route`, `training panel`, or `onboarding help prompts`. These prompts are UI/process updates only unless a separate task requests KML/KMZ importer/exporter contract changes. They must preserve the distinction between Places as reviewed import candidates, Layers as visual context, and projected/local `XY` as canonical project geometry.

Command-surface, toolbar, UI parity, UI-proof, curated sample fixture, generated report, and companion evidence wording prompts route through the interface developer, imagery mapper, and KB curator when they include terms such as `command surface`, `menu bar`, `toolbar`, `toolbar parity`, `UI-proof`, `sample designs`, `curated fixtures`, `visual-proof reports`, `generated reports`, `companion packet`, `appImportable`, or `evidenceOnly`. UI parity means the app exposes the same operator boundaries and local/offline decision rules; it does not mean every local companion CLI report gets an app apply/import path.

Android app-review, layout-proof, ADB/UIAutomator, OCR, and screenshot-analysis prompts route through the interface developer and KB curator when they include terms such as `review:android-app`, `android app review harness`, `verify:android-layout`, `Android layout proof`, `ADB`, `UIAutomator`, `Tesseract`, `OCR`, `OpenCV screenshot analysis`, `touch target`, `drawer/HUD`, `right-drawer`, `right-sidebar`, `toolbar`, `UI-proof`, or `system navigation bounds`. Add the database specialist only when the prompt also asks for SQLite, ZIP, schema, migration, share-sheet, DocumentsUI, or project archive proof. These prompts are app workflow evidence tasks; screenshots/XML/OCR/CV must not mutate canonical projected/local `XY` or satisfy native persistence claims.

Managed-hook, process-enforcement, route keyword, governance keyword, and token-efficient subagent-governance prompts route through `cplayout_kb_curator` when they include terms such as `requirements.toml`, `managed hook`, `hook enforcement`, `process enforcement`, `prompt triage`, `route classification`, `route keywords`, `governance keywords`, `keyword updates`, `coordinator contract`, `coordinator route band`, `subagent reasoning`, `token efficient`, `advisory hooks`, or `reasoning band`. These prompts are configured as coordinator `xhigh` because they affect Codex policy surfaces and multi-agent coordination, but every spawned subagent still receives task-selected effort and a bounded scope.

Runtime proof, release-gate, and production-readiness prompts route through `cplayout_runtime_proof_gatekeeper` when they include strong phrases such as `native proof`, `release gate`, `Android verification`, `iOS verification`, `MapLibre proof`, `SQLite ZIP proof`, `Google Earth render proof`, `non-black map-canvas proof`, `verify:android-native`, `verify:native-maplibre`, or `production-ready claim`. This route blocks claim wording until the relevant completed device, emulator, Google Earth, or release evidence exists. It does not prove runtime behavior by itself and should not trigger from standalone `runtime`, `proof`, or `gate`.

RTK/GNSS prompts route through the interface developer, GIS geometry guardian, and runtime proof gatekeeper when they include strong phrases such as `RTK receiver`, `GNSS hardware`, `Web Serial`, `NMEA epoch`, `NTRIP corrections`, `RTCM corrections`, `Android USB GNSS`, `antenna reference point`, `coordinate epoch`, `GNSS field report`, or `RTK field proof`. The interface lane owns adapter/UI ergonomics, the GIS lane protects WGS84-to-project-CRS authority, and the runtime lane blocks hardware/accuracy claims without receiver, antenna, correction, control-point, disconnect, and current-commit evidence. Broad standalone `GPS`, `serial`, or `receiver` terms should not route by themselves.

GIS and coordinate-authority prompts route through `cplayout_gis_geometry_guardian` when they include strong phrases such as `projected XY`, `projected/local XY`, `canonical geometry`, `CRS boundary`, `WGS84 display`, `WGS84 input/display`, `coordinate transform`, `geometry mutation`, `map package attribution`, `TileJSON`, `PMTiles`, `MBTiles`, `KML/KMZ visual metadata boundary`, or `styleUrl visual-only`. This route preserves canonical projected/local `XY`; WGS84, KML/KMZ, imagery labels, screenshots, OCR/CV output, TileJSON, and operator labels remain input/display/evidence until a projected-XY workflow explicitly accepts them. It should not trigger from standalone `GIS`, `geometry`, `coordinates`, or `display`.

Validation and release-evidence prompts route through `cplayout_qa_validation_reviewer` when they include strong phrases such as `validation triage`, `validation evidence`, `acceptance gate`, `acceptance criteria`, `test gap`, `proof gate`, `audit finding`, `regression evidence`, `release evidence`, `Playwright screenshot`, `proof:web`, `ui:test:start`, `ui:test:status`, `ui:test:stop`, or `npm run validate`. This route reviews evidence and residual risk, including exact local server URL and cleanup status when browser checks use the launcher; it does not convert tests, hooks, generated context maps, launcher health, or static export success into native/runtime proof and should not trigger from standalone `QA`, `validation`, `reviewer`, `test`, or `check`.

Whole-codebase 100-iteration improvement prompts currently route through `cplayout_kb_curator` keywords such as `100 iteration`, `weighted vote`, and `research improvement loop`; there is no separate executable route id named `whole-codebase-100-loop` in `.codex/hooks/cplayout_route_data.json`. Expected artifacts remain `docs/whole-codebase-improvement-loop-2026-06-01.md` plus milestone evidence summaries under `docs/evidence/continuous-improvement/`.

Detailed routing guidance lives in `.agents/skills/cplayout-expert-agent-panels/references/prompt-triage.md`; executable route data lives in `.codex/hooks/cplayout_route_data.json`.

## Tool And Subagent Hooks

`.codex/hooks.json` also registers:

- `SubagentStart` through `.codex/hooks/cplayout_subagent_start.py`, which injects CPLayout boundaries into spawned subagents: read `AGENTS.md`, preserve projected/local `XY`, avoid paid APIs and hidden keys, keep KML/KMZ styling visual-only, and require evidence before runtime proof claims.
- `PreToolUse` through `.codex/hooks/cplayout_pre_tool_use.py`, which narrowly denies clearly destructive commands such as `git reset --hard`, `git clean -fd`, force push, and `npm audit fix --force`. Other CPLayout-sensitive patterns receive advisory context rather than a block.

The project-local `Stop` continuation hook is disabled. `.codex/hooks.json` no longer registers `Stop`, and `.codex/hooks/cplayout_stop_multi_agent.py` remains only as a compatibility no-op for already-loaded command references. Subagent accounting is still required by `AGENTS.md` and by the `UserPromptSubmit` coordinator contract, but missing accounting must not create automatic Stop continuation prompts.

These hooks make missing decisions visible through prompt context, but they do not request another turn at Stop. They are not proof that subagents spawned, that process policy was fully enforced, or that a managed endpoint loaded the scripts.

## Managed Hook Deployment

Project-local `.codex/hooks.json` is advisory because it depends on project trust, local hook feature settings, and hook review. Non-bypass deployment is documented in `docs/codex-managed-hook-deployment.md` with a parseable example in `docs/examples/cplayout-managed-requirements.toml`.

The managed example pins `[features].hooks = true`, sets `allow_managed_hooks_only = true`, defines absolute managed hook directories, anchors the `PreToolUse` matcher, and registers `UserPromptSubmit`, `SubagentStart`, and `PreToolUse` hooks. It intentionally omits `Stop` to avoid continuation loops. It still requires endpoint script deployment, Codex restart, and live `/hooks` verification before any enforcement claim.

## Session-Level Skill Snapshot

Observed direct-use skills during the 2026-05-31 implementation session:

- System skills: `$imagegen`, `$openai-docs`, `$plugin-creator`, `$skill-creator`, `$skill-installer`.
- CPLayout skills: the repo-local skills listed above.
- Plugin skills: Canva presentation/social/translation skills and GitHub PR/CI/publish skills.
- Other local skills: DaVinci Resolve automation, editing, audio, color, Fusion, project factory, production review, and world-regeneration skills.

This section is a snapshot, not a durable guarantee. The active runtime skill list remains the source of truth for future sessions.
