# CPLayout Managed Codex Hook Deployment

Date checked: 2026-06-03

This guide turns the repo-local CPLayout hook scripts into a managed Codex policy surface. It does not change CPLayout product runtime code, schemas, persistence, geometry, map rendering, Google Earth behavior, or native verification status.

## Source-Backed Boundary

Official Codex docs distinguish project hooks from managed hooks:

- Project hooks in `.codex/hooks.json` load only when the project `.codex/` layer is trusted, and changed non-managed command hooks must be reviewed and trusted.
- Managed hooks from system, MDM, cloud, or `requirements.toml` sources are trusted by policy and cannot be disabled from the user hook browser.
- `requirements.toml` can pin `[features].hooks = true`, define `[hooks]`, and set `allow_managed_hooks_only = true` to skip user, project, session, and plugin hooks while still loading managed hooks.
- Codex enforces managed hook configuration from `requirements.toml`, but it does not distribute scripts from `managed_dir`; endpoint management must install them.
- `Stop` receives `last_assistant_message` and `stop_hook_active`, expects JSON on stdout, and can continue a turn with `decision: "block"` plus `reason`.

Sources:

- `https://developers.openai.com/codex/hooks#managed-hooks-from-requirementstoml`
- `https://developers.openai.com/codex/hooks#stop`
- `https://developers.openai.com/codex/hooks#review-and-trust-hooks`
- `https://developers.openai.com/codex/config-reference#requirementstoml`
- `https://developers.openai.com/codex/subagents#custom-agents`

## Managed Hook Files

Install these scripts into an administrator-owned absolute directory on each machine:

| Managed script | Repo source | Event |
| --- | --- | --- |
| `cplayout_prompt_triage.py` | `.codex/hooks/cplayout_prompt_triage.py` | `UserPromptSubmit` |
| `cplayout_subagent_start.py` | `.codex/hooks/cplayout_subagent_start.py` | `SubagentStart` |
| `cplayout_pre_tool_use.py` | `.codex/hooks/cplayout_pre_tool_use.py` | `PreToolUse` |
| `cplayout_stop_multi_agent.py` | `.codex/hooks/cplayout_stop_multi_agent.py` | Disabled compatibility no-op |

Also install or expose `.codex/hooks/cplayout_route_data.json` and `.codex/hooks/cplayout_context_map.json`. `cplayout_prompt_triage.py` first searches upward from the current working directory for these files under `.codex/hooks/`, then falls back to files next to the script. An adjacent route-data copy can support routing outside the checkout, but copying the context-map JSON alone cannot satisfy its source-hash checks. For map-derived first-read refs, run from the matching CPLayout checkout or deploy and verify a complete matching source tree; otherwise the hooks deliberately omit those refs.

Use an absolute managed directory such as:

- Linux/macOS: `/opt/cplayout-codex/hooks`
- Windows: `C:\ProgramData\CPLayout\CodexHooks`

Keep `.codex/hooks/cplayout_route_data.json`, `.codex/agents/*.toml`, and `AGENTS.md` available in the project checkout. The managed scripts still read current repo evidence when they run from a CPLayout workspace.

## Requirements Install

Use `docs/examples/cplayout-managed-requirements.toml` as the starting point. It contains:

- `allow_managed_hooks_only = true`
- `[features].hooks = true`
- `[hooks].managed_dir` and `[hooks].windows_managed_dir`
- managed `UserPromptSubmit`, `SubagentStart`, and `PreToolUse` command hooks with absolute script paths. `Stop` is intentionally omitted to avoid continuation loops.

Deploy it through one of the managed requirements channels documented by Codex:

- Cloud-managed requirements for ChatGPT Business or Enterprise.
- macOS MDM requirements payload.
- System requirements file: `/etc/codex/requirements.toml` on Unix systems or `%ProgramData%\OpenAI\Codex\requirements.toml` on Windows.

After deployment, restart Codex and verify startup output plus `/hooks` show the CPLayout hooks as managed. A project-local `.codex/hooks.json` alone is not an always-on guarantee because it depends on project trust, local feature settings, and per-hook trust review.

## Smoke Checks

Run these from the CPLayout repo after installing scripts and restarting Codex:

```bash
python3 -m py_compile .codex/hooks/*.py
npm run context-map:check
npm run validate:skills
```

Use a prompt like:

```text
Use multi-agent expert panels to review managed hook enforcement for CPLayout.
```

Expected advisory behavior:

- `UserPromptSubmit` emits a bounded advisory route/first-read hint. A route is not an automatic complexity, effort, or spawn decision; the coordinator applies `AGENTS.md` and `docs/agent-tree-protocol.md`. Explicit no-delegation instructions take precedence and an unmatched prompt still requires ordinary preflight.
- `SubagentStart` emits a bounded agent-scope/first-read hint. Map-derived refs are omitted when the context-map source hashes are stale or unavailable; the durable `AGENTS.md` boundary remains.
- `PreToolUse` advises or denies only within its documented command checks.
- `Stop` is not registered. The compatibility script must emit no output even for explicit multi-agent or matched specialist prompts, so missing subagent accounting cannot create automatic continuation prompts.
- The explicit multi-agent smoke prompt emits `Subagent decision: required`; a topic-only specialist match normally emits `optional` and leaves the decision to the coordinator.

## Non-Claims

- This guide does not prove managed hooks loaded on a target machine. That requires a restarted Codex session on the managed endpoint.
- This guide does not prove the generated context map loaded in a live managed session. Verify a matching checkout/source-hash root and live hook output; copying only the JSON beside managed scripts is insufficient for first-read refs.
- This guide does not prove subagents spawned. It only configures advisory context and custom agent files.
- This guide does not prove Android/iOS native runtime behavior, native SQLite, ZIP sharing, raw PMTiles/MBTiles rendering, Google Earth rendering, imagery/CV truth, or canonical geometry mutation.
- KML/KMZ styles remain visual interchange metadata only and must not alter projected/local `XY` project geometry.
