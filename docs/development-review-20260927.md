# Development And Process Review

Date: 2026-09-27. Scope: current progress, plan reconciliation and efficient
resumption, not certification of the full product. Complexity/selected reasoning:
xhigh because this spans product priorities and governance. Subagent decision:
required; accepted fallback for this review: the preceding test worker hit the
runtime usage limit. Its files were preserved, agents closed, and the coordinator
reviewed the frozen current state directly. Earlier independent geometry findings
are identified as such, not a new multi-agent vote.

## Findings

1. **High: user workflows lag behind domain implementations.** Drawing pause,
   classification and autosave have core contracts/catalog code, but searches of
   `DesignDraftWorkspace.tsx` and `DesignDraftMapSurface.tsx` find no workflow,
   pause/resume, classification or autosave integration. Field documents/editor
   and the new template planner likewise have no App activation. Native workspace
   composition is not the default native repository. Another source-only helper
   is not a substitute for completing these workflows.
2. **High: validation sometimes targets moving inputs.** The independent review
   executed the template tests while their author changed fixtures: 17 passed,
   three failed at that point. After author termination and explicit coordinator
   ownership, a fresh run of the retained file passes 20. The earlier mixed-version
   run remains diagnostic, not acceptance. Existing records also document export
   and aggregate overlap with edits. Freeze tests as well as application source.
3. **High: integration/publication debt is growing.** Preflight counted 180 status
   entries: 70 tracked changes and 110 untracked entries. Both `main` and a local
   governance branch exist. Fresh `gh repo view` confirms the requested public
   JakeC-Redlund repository with default `main`; `git ls-remote` matches the local
   committed HEAD. The governance branch has no unique commits (`main...branch`
   is 1/0) and its hosted SHA also matches. This does not publish dirty changes
   or prove issue/PR/secret/protection migration; those were not inspected.
   Preserve work; plan ownership-based commits after acceptance, never blanket
   staging or branch deletion to manufacture a clean result.
4. **Medium: several records claim to be current and disagree.** The focused
   plan still prioritizes August RTK work and says the first visual packet is
   pending. The language plan says not implemented despite U01-U05 completion.
   Full-refactor history mixes multiple same-day open/closed-server statements.
   A compact current index now supersedes those scheduling claims, not their
   requirements, historical failures or proof limitations.
5. **Medium: context and orchestration overhead are not tied to delivered value.**
   Seven frequently used guidance files total 321,380 UTF-8 bytes at pre-review
   capture; `full-refactor-execution.md` alone is 118,030 bytes and the Will Rhea
   log 65,240. These are file-size observations, not measured prompt tokens.
   Repeated whole-file reads, large tool metadata responses, duplicate probes,
   premature exports and workers blocked on each other increase avoidable work.
   Cumulative goal usage is not per-packet cost attribution.
   `App.tsx` is 9,131 lines and the advisory placement module 4,371 lines;
   assign exact sections and extract along tested workflow boundaries as those
   workflows are integrated, rather than launching a blanket rewrite.

## Progress Matrix

| Area | Verified current/source evidence | Not established / next gate |
| --- | --- | --- |
| Dependencies | Current full and production npm audits: zero findings; no upgrade needed for this review. | Audit is not package/runtime qualification. Preserve isolated upgrade packets. |
| Drawing | Polygon/Line/Point surface exists; versioned durable captures and classification catalog/editor code exist. | Actual classification/autosave/pause/reopen interface, end-to-end recovery and renderer parity. |
| Report/UI | Scoped price and feet-based input helpers; U01-U05 receipt records acceptance of marked primary forms. | Lower generated metric/technical labels, full report acceptance, help parity. |
| Independent machines | `field-design-v1` document/editor; new mixed-template search retains exact configurations. Twenty focused tests pass. | Workspace/archive activation, atomic adoption, editable saved instances, two identified edge-case tests. |
| Geometry | Projected-XY constraints and legacy golden checks pass; mechanical-only obstacle bug reproduced and corrected in shared candidate admission. | Global optimum, continuous corner motion, hydraulic/equipment/site qualification. |
| Design-to-Layout | Existing workflow guards and qualification structures are present. | Immutable saved target handoff and full precision-gated user workflow remain open in the workflow contract. |
| Native storage | Source adapters/tests; native integration record reports limited Android artifact-service evidence. | Default repository/bridge/JNI, complete current-build migration/crash/reopen/sharing acceptance. No new device run here. |
| GNSS/RTK/electrical | Source receiver profiles, transport-switch controller and capture qualification modules exist. | Physical PX1122R/NS-RAW, ESP32/XBee/relay/level-shifting commissioning; Android transports; later iOS; surveyed maximum 3D error <0.10 m. |
| Imagery/maps | Metadata and source adapter lanes; historical artifact-specific browser/native/Google Earth evidence. | Current raw PMTiles/MBTiles/local raster/native parity and applicable rights/device proof. |
| CV/ML/review tooling | Local companion/review receipt implementation and recorded tests; recent U01-U05 receipt independently byte-verified. | No new model promotion, real-field quality proof or automatic geometry authority. |
| Governance/release | Task-selected effort, scoped leaves and local hook validators exist; unused owned sessions closed. | Managed policy enforcement, per-packet token effectiveness and publication/release remain separate. |

Matrix sources: current module searches; [drawing](drawing-workflow-contract.md),
[field](field-design-contract.md), [native](native-workspace-integration.md),
[hardware](receiver-hardware-qualification.md), [CV](local-cv-browser-modernization-acceptance.md),
[imagery](imagery-ml-capability-roadmap.md), and [workflow](mapping-workflow-review.md)
contracts. Historical runtime results were inspected as records, not re-executed
or promoted to current-build proof. This review is not an exhaustive code audit.

## Refocused Method

The ordered deliverables and exit gates are in [development-status.md](development-status.md).
Finish the existing safety/test handoff, then the requested drawing journey;
activate independent saved machines next. Avoid further optional model/CV/tool
expansion while these user journeys remain unfinished. Integrate the current
domain foundations instead of replacing them with new architectures.
After a prerequisite source packet, make integration into its intended workflow
the next dependency where feasible; do not substitute another unrelated helper
or review packet because it is easier to validate.

- **Context:** standard instructions, compact status, one task leaf and exact
  source ranges. Search history for a specific question; do not load whole logs
  or the entire source ledger by default. Retrieve only needed tool definitions.
- **Delegation:** one critical-path coordinator; smallest useful independent
  reviewer/worker set. Each gets a bounded question, exact files, output limit and
  stop condition. Do not redo delegated probes. Reuse the reviewer for correction
  checks when available; stop retrying after a confirmed quota failure.
- **Verification:** author focused tests -> explicit source/test freeze ->
  independent targeted QA -> one aggregate -> one matching export/browser packet
  when relevant. Fix actual failures, retain failed evidence, rerun affected
  checks. Never pool partial passes into full acceptance. Documentation-only
  work uses skills/context/links/diff checks, not another product rebuild.
- **Resumption:** persist exact next action and live command handles. Poll a
  confirmed live handle; don't restart because a poll timed out. Reopen research
  only for changed inputs, expired sources, disagreement or a specific evidence gap.
- **Resources:** open visible Edge only for a bounded workflow; export responses,
  close completed owned tabs and stop owned servers. Leave pending questionnaires
  only while actively needed. Preserve unrelated listeners and user data.

## Research Basis

Official pages checked 2026-09-27; these support methods, not measured local gains:

- [Codex best practices](https://learn.chatgpt.com/guides/best-practices): keep
  practical durable instructions concise and link task-specific detail. Apply by
  routing broad resumes to one small status file, preserving deeper evidence.
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents):
  subagents consume additional tokens; independent work and concise summaries
  help, while parallel writing adds coordination risk. Apply by bounding ownership
  and waiting for test freeze before independent execution.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):
  prefix stability matters; fewer bytes alone do not establish lower cost.
  Keep durable instructions stable and measure actual exposed usage. This review
  changes no API caching, account, model or managed runtime settings.

## Measurement And Acceptance

For the next three accepted product packets, record per packet: user outcome,
loaded guidance bytes, changed paths, agent count/scope, exposed input/cached/
output tokens if available, wall time, aggregate/export run counts, invalidated
runs, escaped defects and accepted workflow evidence. Missing counters are
`unavailable`, never estimated as measured facts. Compare like-risk packets; no
claimed token/cost percentage or speedup until observations support it.

At a pre-completion checkpoint, the goal runtime reported `tokensUsed: 125191`
and `timeUsedSeconds: 959` for this review goal. This is cumulative runtime
accounting, not final consumption, billable usage or a comparable product-packet
benchmark. Input/cache/output breakdown and monetary cost were not exposed.

Operational targets (policies, not demonstrated results): one active deliverable,
one aggregate owner, zero verification runs invalidated by concurrent edits,
no unused owned map tabs/servers, and a compact status file under 8 KiB. Start
with coordinator plus one independent scope; add agents only for independent
work that shortens the critical path or supplies necessary evidence. Existing
six-slot runtime capacity remains a ceiling, not a target.

Validation in this review: 20 final template tests pass; legacy output/scheduling
checks pass; full/production audits report zero. `npm run validate` passed in
846.29 seconds, including 346 native-workspace source tests with no failures or
skips. Log: `/tmp/cplayout-process-review-validate.log`, SHA-256
`e5df87a0921ac1cf95aeb2da22845c83edf94cb7832b15b91771bb808a3813de`.
All 507 paths in `/tmp/cplayout-process-review-source-before.json` remained
unchanged afterward. This manifest covers listed source/config inputs, not all
assets or installed dependencies. It is not installed-device build identity.

Final skill validation, context-map freshness and `git diff --check` pass.
An intermediate context-map check correctly reported staleness after documentation
changes; regeneration and final verification passed. Final launcher status has
no owned servers; dedicated Edge inventory retains only the unrelated extension
tab. No new browser/device/field test or publication is claimed. Two identified
template edge-case regressions remain queued despite the aggregate pass.
Completing this review does not complete the underlying full refactor or prove
token savings. The next-three-packet measurement is a prospective evaluation,
not a reason to keep this completed review indefinitely active.
