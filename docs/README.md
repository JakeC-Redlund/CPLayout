# CPLayout Docs Index

CPLayout is an offline-first, no-cost center-pivot planning app. Canonical project geometry is projected/local `XY`; WGS84, imagery, KML/KMZ styling, screenshots, OCR/CV, and Google Earth observations are input, display, or evidence layers unless a separate projected-XY workflow explicitly accepts geometry through validation.

## Required First Reads

- `AGENTS.md`: durable repository rules, preflight, reasoning policy, subagent policy, and validation gates.
- `docs/agent-tree-protocol.md`: coordinator/leaf handoff, first-read selection, decision and proof boundaries.

Broad development resumes: [current status and next queue](development-status.md).
The [2026-09-27 process review](development-review-20260927.md) reconciles older
plans and defines measurement; historical logs are not default first reads.

Use `docs/agent-context-map.md` as a task-specific index, not an unconditional third read. Open the matching leaf skill or module first; use `docs/agent-prompt-registry.md` and generated governance records only for routing/governance work.

## Task-Specific Docs

- Governance, hooks, skills, managed policy: `docs/agent-prompt-registry.md`, `docs/agent-source-ledger.md`, `docs/agent-known-gaps.md`, `docs/codex-managed-hook-deployment.md`.
- Phased tree rollout, Git checkpoint and CI gates: `docs/agent-tree-rollout.md`.
- Local UI testing server launcher and Windows Desktop shortcut: `docs/local-ui-testing-server-launch.md`.
- Storage, archives, native proof: `docs/android-native-verification.md`, `packages/project-store/src/index.ts`, `packages/project-store/src/projectArchive.ts`, `packages/project-store/src/projectRepository.native.ts`.
- RTK/GNSS hardware, corrections, capture provenance, and field proof: `docs/rtk-gnss-integration-plan.md`, `docs/gnss-runtime-verification-report-template.json`, `packages/gnss/src/index.ts`, `tools/roadmapCompletion.ts`.
- Derived GNSS 3D evidence contracts and physical/native acceptance blockers: [gnss-derived-evidence-contract.md](gnss-derived-evidence-contract.md).
- Owner hardware, verified electrical specifications, level-shifting decisions and bench/field gates: [receiver-hardware-qualification.md](receiver-hardware-qualification.md).
- Direct package inventory, current alignment, advisories, and upgrade gates: `docs/dependency-upgrade-plan.md`.
- Shared mapping controller, renderer boundaries, and regression coverage: [mapping-refactor-plan.md](mapping-refactor-plan.md).
- Polygon, Line and Point drawing, measurements, research and safety boundaries: [drawing-tools-refactor.md](drawing-tools-refactor.md).
- Received drawing questionnaire answers, partial visual implementation and remaining classification/autosave/pause work: [drawing-review-response-plan.md](drawing-review-response-plan.md).
- Durable unfinished drawings, document compatibility and pause/save integration: [drawing-workflow-contract.md](drawing-workflow-contract.md).
- Independent machines, common-field document and conversion/editor contracts: [field-design-contract.md](field-design-contract.md).
- Calculation report fields, temporary inputs, save boundaries and evidence limits: [calculation-report-workflow.md](calculation-report-workflow.md).
- Visible Windows Edge screenshots, annotation and reliable answer-recording procedure: [windows-edge-visual-review-plan.md](windows-edge-visual-review-plan.md).
- Live browser answers, agent updates, durable receipts and review-tab replacement: [interactive-browser-review.md](interactive-browser-review.md).
- Agricultural mapping/RTK quality review, comparison criteria, and improvement packets: [mapping-rtk-quality-program.md](mapping-rtk-quality-program.md).
- Current Design-to-Layout safety packet, verification and remaining implementation sequence: [mapping-workflow-review.md](mapping-workflow-review.md).
- Active full-refactor execution queue, worker ownership, checkpoints and resumption gates: [full-refactor-execution.md](full-refactor-execution.md).
- Next incomplete-design and atomic catalog packet, with migration/rollback and fault-injection gates: [draft-catalog-implementation.md](draft-catalog-implementation.md).
- GitHub parent migration, authorization, recovery, and publication state: [github-migration-plan.md](github-migration-plan.md).
- Imagery, KML/KMZ, Google Earth, ML/CV: `docs/kml-kmz-google-earth-source-ledger.md`, `packages/core/src/imageryEvidence.ts`, `docs/imagery-ml-capability-roadmap.md`.
- Interface and visible web/native proof: `apps/mobile/App.tsx`, `packages/map-adapters/src/SvgMapSurface.tsx`, `docs/android-native-verification.md`.
- Pivot, corner-arm, and irrigation design evidence: `docs/design-guides/topic-index.md`, `docs/corner-service-manuals/topic-index.md`, `packages/geometry/src/index.ts`.
- Corner-arm mechanism research, reconciled sources, synthetic trajectory verification and graph/spline experiments: [research and development handoff](corner-arm-geometry-research-plan.md), [source/package matrix](corner-arm-research-sources.md), [reproduction commands](../tools/corner-arm-research/README.md).

## Optional Deep Records

- `docs/agent-source-ledger.md`: dated local and external source rows with boundaries.
- `docs/agent-known-gaps.md`: section-addressable proof gaps and non-claims.
- `docs/whole-codebase-improvement-loop-2026-06-01.md`: batch-classified loop inventory.
- `docs/evidence/`: curated proof summaries and hashes. Raw reports under ignored `reports/` are not durable records by default.

## Validation Commands

- `npm run context-map:build`: regenerate context-map JSON and generated docs after route/governance changes.
- `npm run context-map:check`: fail when generated context-map outputs are stale.
- `npm run validate:skills`: validate skills, hooks, route data, context map, required docs, and process records.
- `npm run validate`: run TypeScript and workspace tests after TypeScript or UI changes.
- `npm run test:visual-review`: validate answer receipts, questionnaire restore/export and image-bearing packets; semantic browser tests supplement visible Edge review.
- `git diff --check`: catch whitespace errors.
- `npm audit`: report dependency advisories without force fixes.
