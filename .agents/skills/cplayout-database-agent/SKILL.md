---
name: cplayout-database-agent
description: Use for CPLayout SQLite, project-store, archive, schema, migration, CRUD, local persistence, database research, and storage verification planning.
---

# CPLayout Database Agent

## Core Rule

Preserve CPLayout's offline-first storage split and archive contracts. Database changes must keep canonical projected/local `XY` geometry, project documents, native SQLite, web MVP storage, and ZIP archive round-trips consistent.

## Workflow

1. Run the CPLayout preflight: read the current user task and coordinator-assigned scope, inspect `git status --short`, and preserve unrelated work.
2. Identify whether the task touches `packages/project-store/`, `packages/core/`, `packages/geometry/`, `packages/gnss/`, app UI, archive export/import, or docs.
3. For legacy project persistence, use `packages/project-store/src/projectRepository.native.ts` and Expo SQLite. Select the authenticated workspace repository for the current account-bound App; see the authenticated service section below.
4. Legacy web project persistence uses `packages/project-store/src/projectRepository.ts`. Keep it distinct from authenticated workspace persistence and from any future explicitly qualified Expo SQLite web WASM deployment.
5. Keep project ZIP packages round-tripping through `packages/project-store/src/projectArchive.ts` and validating through `packages/core/src/projectDocument.ts`.
6. Coordinate interface changes with `$cplayout-interface-development-agent` and design/pivot data with `$cplayout-center-pivot-design-agent`.

## Database Standards

- Prefer source-backed SQLite and Expo SQLite behavior.
- Use prepared statements or parameter binding for user input.
- Plan migrations, indexes, constraints, transaction boundaries, validation, rollback, and export/import compatibility before edits.
- Do not claim Android, iOS, web SQLite, ZIP sharing, or native MapLibre runtime behavior without the relevant device/browser verification evidence.
- Before an Expo SDK patch install, inventory exact peers across every workspace manifest, including `packages/backup-artifacts/package.json`, and the SQLite ownership-patch support matrix. Review the coherent Expo/core/JSI/SQLite source and lock together; retain failed peer or core-guard refusals and never bypass guards to complete an install.
- Recheck installed guards after a clean exact-lock install. Consumed-API and patch-source compatibility, installed-matrix validation, online update discovery and rebuilt native runtime are separate claims; follow `docs/dependency-maintenance.md` and the registry's actual receipts.
- Service whole-workspace recovery import must strictly advance the locked destination revision after V3 refusal, retaining the reviewed raw file on equal/lower refusal. Never change its revision to force admission or suggest public revision-zero bootstrap: normal V5 bootstrap is revision 4. Legacy database insertion/read/exact-source upgrade are separate paths; use `docs/workflow-maintenance-guide.md` and matching CAS regression receipts.

## Non-Goals

- No paid cloud database, hidden API key, or online-only persistence dependency.
- No automatic schema migration that bypasses project document validation.
- No local machine paths in project export data.

## Outputs

Return schema impact, affected files, migration and archive implications, CRUD risks, validation commands, source-backed package claims, and unverified runtime gates.

## Authenticated service and current records

For customer/project sign-in and shared service work, inspect `apps/api/`,
`packages/auth-client/`, `apps/mobile/src/auth/` and the retained project-store
contracts together. For cross-module account/revision, Survey retention, Layout
history and recovery invariants, read the shared
[workflow records guide](../cplayout-workspace-preflight/references/workflow-records.md).
Use its requirement IDs to retrieve current status and source-bound receipts from
`docs/workflow-registry.json`. Do not copy runtime support or review status into
this entrypoint; local fixtures do not establish deployed or native operation.
