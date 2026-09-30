# CPLayout Agent Tree Protocol

This is the compact first read after `AGENTS.md` for non-trivial CPLayout work. The coordinator owns the task, Git state, decisions, integration, and final claims. A leaf agent receives one bounded question or disjoint write scope and returns a small evidence packet. Repo-local hooks and this document advise the workflow; neither enforces it or proves a model, subagent, device, or managed endpoint ran.

## Route The Work

1. Preflight: re-read `AGENTS.md`, inspect `git status --short`, branch and base OID, preserve existing work, and classify risk before mutation. Record `complexity band`, selected reasoning effort, `Subagent decision: required/optional/not useful`, and validation gates.
2. Select the smallest relevant leaf from the table below. Read its one or two context-map first reads; use secondary paths only for a concrete unanswered question. Prompt keywords are hints, not authority. A broad request gets a coordinator decomposition before any leaf writes.
3. Delegate independent read-heavy research or review in parallel. Give each writer exclusive files and one integration owner. Use a task-selected model/effort for each agent; a coordinator `xhigh` route does not propagate automatically. Keep the coordinator on the critical path.
4. Integrate serialized changes against the current worktree, validate the affected contract, obtain independent QA for shared or high-risk surfaces, and report what is source-checked, runtime-observed, published, and still unverified.

Schedule leaves as a dependency graph: start only tasks whose inputs are available; parallelize independent read-only evidence, serialize writers by path, and keep one integration owner. Do not occupy a slot with a leaf waiting on another leaf's result. Re-scope or cancel stale work when its base changes, then run independent QA against the integrated diff. The local concurrent-agent cap is a ceiling, not a target.

For broad resumes, select one user-facing deliverable from `docs/development-status.md`; retain the larger scope without reopening every lane. Default to the coordinator plus the smallest useful independent scope. Freeze implementation and test files before independent execution; read-only implementation review can precede that freeze. One coordinator owns aggregate validation/export, and any changed inputs invalidate their matching acceptance. Record command handles, source identity, results and the next action once in the current handoff. Use raw logs only to investigate failures. Confirmed quota failure gets a documented fallback, not repeated spawn attempts. Byte counts are context proxies; record actual usage when exposed and leave unavailable metrics explicit.

| Leaf | First entrypoint | Typical boundary |
| --- | --- | --- |
| Interface | `.agents/skills/cplayout-interface-development-agent/SKILL.md` | Expo UI and web proof; no native parity claim from browser tests. |
| Geometry/design | `.agents/skills/cplayout-center-pivot-design-agent/SKILL.md` | Advisory pivot/irrigation reasoning; no certified or automatic field design. |
| GIS | `.agents/skills/cplayout-gis-geometry-guard-agent/SKILL.md` | Projected/local `XY` authority and CRS; WGS84 is input/display. |
| Storage | `.agents/skills/cplayout-database-agent/SKILL.md` | Project repository, SQLite, ZIP; web/native backends stay distinct. |
| Imagery | `.agents/skills/cplayout-imagery-mapping-agent/SKILL.md` | Source/attribution and visual evidence; no imagery-to-geometry promotion. |
| Runtime proof | `.agents/skills/cplayout-runtime-proof-gate-agent/SKILL.md` | Device and release evidence; no source-only promotion to runtime proof. |
| QA | `.agents/skills/cplayout-qa-validation-agent/SKILL.md` | Acceptance and regression evidence; independent of the writer. |
| Governance | `.agents/skills/cplayout-expert-agent-panels/SKILL.md` | Hooks, records, source freshness, routing and decision audit. |

`docs/agent-context-map.md` indexes precise package paths and secondary reads. Existing `apps/*` and `packages/*` workspace boundaries already provide product leaves; no product-package relocation is justified by this governance change. Keep local reports and machine paths out of published context packs.

## Leaf Handoff Packet

The coordinator's task must state: base OID and dirty owner; leaf ID and one-sentence objective; exact read/write paths and no-overlap boundary; complexity, model and effort selected for that leaf; at most three initial reads; requested output shape; source/proof gates; a stopping condition. Writers must be told they share a worktree and must not revert others' changes. An absent tool, missing evidence, or unresolved conflict returns a bounded blocker, not a guess.

The leaf returns: changed paths or finding with line references; direct evidence and source date; commands with pass/fail/skip; remaining unknowns; claim class (`source`, `browser`, `native/device`, `field`, `managed-hook`, or `publication`); and a concise integration/rollback note. The coordinator checks the current diff and owns the final claim. A read-only specialist does not authorize mutation, publication, or release.

## Decisions And Cost

Hard constraints in `AGENTS.md` veto a proposal regardless of votes. For a contested cross-domain governance decision, use the generated `xhigh_governance` panel weights (knowledge context 0.30, hook/tooling 0.25, QA 0.20, domain 0.15, offline/security 0.10) as a documented comparison, not an automatic five-agent spawn. Require independent evidence where roles overlap, record minority objections, and state the chosen action and rollback. Trivial or narrow choices need no panel.

Use `low` only for trivial status/formatting, `medium` for narrow docs/tests or read-only scans, `high` for bounded behavior-risk implementation/review, and `xhigh` for architecture, storage, native/runtime, package/platform, release or managed-policy decisions. Select per leaf, not by inheritance. Start with a single capable agent for coupled work; delegate only when independence or QA value exceeds coordination cost. Keep stable instruction prefixes short, route IDs concise, and raw logs outside prompts. Measure UTF-8 hook bytes and, where the runtime exposes them, actual input/cached/output tokens and latency. Byte reduction is a proxy, not a token or cost guarantee. See [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [hooks](https://learn.chatgpt.com/docs/hooks), and [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Publication And Proof

Before a new high-risk batch, inventory dirty tracked, untracked and relevant ignored work; preserve an off-worktree recovery packet; review exact staged paths, secrets/rights and diff; validate; commit with the actual change scope; verify remote/default branch and ancestry; push without force; confirm matching OIDs and a clean worktree. If the remote moves, stop and reconcile rather than overwrite. A clean Git fixed point is not product readiness.

Keep static tests, browser proof, native/device reports, Google Earth render/cleanup, physical GNSS/field qualification, managed hook loading, and hosted publication as separate evidence gates. Never infer one from another. Project-local hooks remain advisory until a fresh trusted session proves injection; managed deployment requires separate endpoint installation, restart, and `/hooks` evidence. Stop continuation remains disabled.
