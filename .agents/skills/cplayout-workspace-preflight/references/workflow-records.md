# Shared workflow invariants and current records

Load this reference only for account/catalog, Survey, Layout or recovery work.
It keeps stable cross-module preservation rules in one place. Current requirement
status, version/runtime support, source fingerprints, failures, receipts, owners
and next actions belong in [workflow-registry.json](../../../../docs/workflow-registry.json).
The [maintenance guide](../../../../docs/workflow-maintenance-guide.md)
defines record updates and acceptance. This reference grants no runtime or
publication authority and does not restore withdrawn AGENTS instructions.

| Task | Registry requirements to inspect |
| --- | --- |
| Sign in, shared reads/writes and authorization | AUTH-01, RECOVERY-01 |
| Customer → Project → Field context and actual saved content | HIERARCHY-01, ENTRY-01 |
| Optional Design, direct Survey preparation and receiver lineage | FLOW-01, SURVEY-01 |
| Official Layout creation, marking, finalization and references | LAYOUT-01, SURVEY-01, RECOVERY-01 |
| Deletion, retained ancestors and missing-parent history | ANCESTRY-01, RECOVERY-01 |
| Interface wording, evidence or whole-workflow acceptance | UI-01, QA-01, DOC-01 |

Read each selected requirement's source paths, dependencies, current evidence
and next action before editing. Current status changes once in the registry;
`docs/development-status.md` is its generated projection. Historical R7/R8 or
other scoped receipts retain their exact original scope. They cannot qualify
later changes, complete a missing census or turn a failed packet into a pass.

## Catalog and account ownership

- Present logical Customer → Project → Field ancestry using existing IDs and
  saved documents. Do not invent filesystem folders, copied entities or new
  document-kind taxonomies. Include zero-project customers from the actual
  authorized customer snapshot. Browsing and explicit Open remain separate.
- Use a revision-matched whole-workspace snapshot for field content and exact
  Survey/Review/Layout association. Show loading/error/Retry rather than guessed
  fallback. A local profile or another tab's cookie is not the admitted client's
  authentication or publication authority.
- Bind additive catalog metadata to its actual revision, principal and policy
  under the authorized row lock. Preserve prior endpoint compatibility and the
  account/policy mismatch recovery path. Recheck read admission after JSON
  delivery and every awaited cache/final-lock/persistence callback using the
  captured account, epoch, principal and actual permission.
- Network-only offline fallback retains its own signed authorization and cache
  partition. Optional principal headers bind the server actor. A stale-admission
  counterexample in one shared workspace is not proof of a foreign-tenant leak.
  Successful server commits remain authoritative after retired client delivery;
  do not infer rollback or exactly-once UI behavior.

## Survey evidence and recovery

- Manual Design is optional and requires no receiver. Live Survey collection
  uses fresh owned RTK Fixed admission. Direct saved Draft→Field preparation
  retains the exact original Draft and full collection lineage through the
  existing schema (`prepare_surveyed_field` / `convertSurveyDraftToField`).
  Do not require completed planning/calculation or invent water/power coordinates.
- Keep unknown infrastructure absent. Supplied machine/pivot data must satisfy
  its actual configuration and pose. Measured coordinates come from selected
  observations; reuse the Survey-owned input surface and retain unfinished work.
- Block future ancestor deletion whenever retained active or archived Survey
  references that field, in the authoritative transaction. Historical orphans
  remain readable/exportable with parent unavailable; do not guess ancestry,
  cascade-delete evidence, discard empty Drafts or make old schemas unreadable.

## Layout preservation and proof

- Official Layout binds its exact matched saved Survey review, included
  collections, source revision and CRS. Stored view/export may remain offline
  within authorization; creation/live collection/marking require current owned
  receiver admission. Retain manual/planned provenance and historical
  unqualified layouts. A fresh destination review precedes Layout.
- Preserve one mounted workspace/map and immutable target geometry. V3 creation,
  field, target and finalization/reference metadata must survive every writer,
  including downgrade and observation-prefix rewrite attempts. Generic Web
  operational transitions revalidate current Survey/target/source and the final
  live owner predicate; a new non-reference session cannot arrive prepopulated
  or finalized.
- A finalized measured-station map requires every frozen target's latest actual
  mark, entered positive tolerance, within-tolerance result and a fresh final lock.
  Keep original official reads/exports and the dedicated same-original-field
  non-official reference import, exact target/Survey IDs and original observations
  without inherited finalization. Refuse bulk/raw V3 restore without original
  service/workspace/account proof and refuse cross-field reference placement.
  Copies are empty reference plans; finalized/reference maps cannot be marked.
- Preserve frozen V1/V2 reader and CRLF source bytes. Check the registry for
  current SQLite/workspace version support instead of copying a point-in-time
  claim here. Receiver admission, wall-clock chronology, nested-lock actor
  attribution, native host support and physical accuracy require distinct proof.

Source/API/archive/atomic-store checks, served-App behavior, native secure storage,
physical receiver precision and human acceptance are separate evidence classes.
Preserve full failed attempts and complete corrective reruns separately. Stable
rules above constrain implementation; their presence is not acceptance evidence.
