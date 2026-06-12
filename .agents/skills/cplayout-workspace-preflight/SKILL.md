---
name: cplayout-workspace-preflight
description: Use before CPLayout repository changes to load local instructions, inspect dirty-tree state, preserve native/web verification gates, and select appropriate validation commands.
---

# CPLayout Workspace Preflight

Use this skill before non-trivial CPLayout edits.

## Steps

1. Re-read `AGENTS.md` and any task-specific docs named by the user.
2. Run `git status --short` and treat existing changes as user or prior-agent work unless proven otherwise.
3. Confirm current package paths before editing: mobile code lives in `apps/mobile/`; shared logic lives in `packages/core/`, `packages/geometry/`, `packages/gnss/`, `packages/map-adapters/`, and `packages/project-store/`.
4. Preserve the offline-first/no-cost boundary: no paid maps, cloud backend, hidden keys, or trial-only SDKs.
5. Preserve data boundaries: projected/local `XY` is canonical project geometry; WGS84 is input/display unless a schema change explicitly says otherwise.
6. Preserve runtime gates: web MVP persistence uses browser local storage; native SQLite, ZIP sharing, native MapLibre, and raw PMTiles/MBTiles rendering are not production-verified without device/emulator evidence.
7. Select validation before editing. Default to `npm run validate`, `git diff --check`, and `npm audit`; add web screenshot checks for visible UI changes and Android checks only when native verification is in scope.
8. For local browser UI server launches, prefer the repo-owned commands: `npm run ui:test:start -- --no-open` for static export checks, `npm run ui:test:status` for current launcher state, `npm run ui:test:stop` for cleanup, and `npm run dev:web:smart` only for Expo live reload. Do not kill unknown port listeners; use status output and the exact printed URL.

## Output Expectations

- State the dirty-tree context and relevant pre-existing changes.
- Name the files/modules you will edit.
- For any browser UI check, state the exact server command and URL used, and whether cleanup through `npm run ui:test:stop` was run or intentionally skipped.
- Name any blocker that prevents a production verification claim.
