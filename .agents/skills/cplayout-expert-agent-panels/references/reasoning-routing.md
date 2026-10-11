# Reasoning Routing

Select reasoning from the current task and explicit coordinator assignment; withdrawn AGENTS.md instructions are historical evidence. There is no repo-wide reasoning-effort fallback. Every non-trivial pass records the task complexity band, selected coordinator reasoning effort, subagent decision or fallback, and validation gates before mutation. A route-data `xhigh` value is coordinator guidance, not automatic subagent effort inheritance.

## Complexity Bands

Use `xhigh` only when the task analysis warrants it, including:

- package architecture, storage, maps, native gates, cross-package changes, and source-backed research,
- release arbitration, reviewer disagreement, security/safety, and native verification disputes.
- managed Codex policy, hook deployment, subagent process, Google Earth proof, and broad cross-module mutation.

Use `high` for bounded implementation or review with meaningful behavior risk. Use `medium` for narrow docs, tests, fixtures, or read-only scans. Use `low` only for trivial status or formatting work. Assign each subagent a task-selected reasoning level based on its own scope, expected output, and risk.

## Routing Output

Every panel cycle should state:

- complexity band,
- selected coordinator reasoning level,
- subagent reasoning level and no-overlap scope for each delegated lane,
- why that level is sufficient,
- what would trigger escalation,
- validation gate that must pass before stronger claims are made.
