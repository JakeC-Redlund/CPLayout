#!/usr/bin/env python3
"""Validate CPLayout repo-local skill and agent process surfaces."""

from __future__ import annotations

import json
import subprocess
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUICK_VALIDATE = (
    Path.home()
    / ".codex"
    / "skills"
    / ".system"
    / "skill-creator"
    / "scripts"
    / "quick_validate.py"
)

REQUIRED_AGENT_FILES = (
    ".codex/agents/cplayout_imagery_mapper.toml",
    ".codex/agents/cplayout_interface_developer.toml",
    ".codex/agents/cplayout_center_pivot_designer.toml",
    ".codex/agents/cplayout_database_specialist.toml",
    ".codex/agents/cplayout_kb_curator.toml",
    ".codex/agents/cplayout_runtime_proof_gatekeeper.toml",
    ".codex/agents/cplayout_gis_geometry_guardian.toml",
    ".codex/agents/cplayout_qa_validation_reviewer.toml",
)

REQUIRED_DOCS = (
    "docs/agent-tree-protocol.md",
    "docs/agent-tree-rollout.md",
    "docs/agent-prompt-registry.md",
    "docs/agent-source-ledger.md",
    "docs/agent-known-gaps.md",
    "docs/agent-governance-summary.md",
    "docs/agent-context-map.md",
    "docs/README.md",
    "docs/codex-managed-hook-deployment.md",
    "docs/examples/cplayout-managed-requirements.toml",
    ".codex/hooks/cplayout_context_map.json",
    ".agents/skills/cplayout-expert-agent-panels/references/prompt-triage.md",
)

REQUIRED_ROUTE_IDS = {
    "cplayout_imagery_mapper",
    "cplayout_interface_developer",
    "cplayout_center_pivot_designer",
    "cplayout_database_specialist",
    "cplayout_kb_curator",
    "cplayout_runtime_proof_gatekeeper",
    "cplayout_gis_geometry_guardian",
    "cplayout_qa_validation_reviewer",
}

COMPLEXITY_BANDS = {"low", "medium", "high", "xhigh"}
REASONING_EFFORTS = {"minimal", "low", "medium", "high", "xhigh"}
SUBAGENT_REASONING_EFFORTS = {"task_selected"}
SPAWN_POLICIES = {"required", "optional", "not_useful"}
ROUTE_POSITIVE_KEYWORD_LIMITS = {
    "cplayout_kb_curator": 60,
    "cplayout_runtime_proof_gatekeeper": 30,
    "cplayout_gis_geometry_guardian": 30,
    "cplayout_qa_validation_reviewer": 25,
}
REQUIRED_ROUTE_KEYWORDS = {
    "cplayout_imagery_mapper": {"will rhea", "jason harmelink"},
    "cplayout_interface_developer": {
        "hud",
        "bottom hud",
        "map workspace",
        "right-sidebar",
        "right-drawer",
        "toolbar",
        "ui-proof",
    },
    "cplayout_center_pivot_designer": {
        "lrdu",
        "sdu",
        "safety zone",
        "drive unit tire",
        "motor rpm",
        "corner angle",
        "corner arm extension",
        "corner arm retraction",
    },
    "cplayout_kb_curator": {
        "advisory hooks",
        "context-map",
        "coordinator route band",
        "route data",
        "subagent reasoning",
        "token efficient",
        "validate_cplayout_skills",
        "xhigh coordinator",
    },
    "cplayout_runtime_proof_gatekeeper": {
        "native proof",
        "release gate",
        "Android verification",
        "iOS verification",
        "MapLibre proof",
        "SQLite ZIP proof",
        "production-ready claim",
    },
    "cplayout_gis_geometry_guardian": {
        "projected XY",
        "CRS boundary",
        "WGS84 display",
        "coordinate transform",
        "map package attribution",
        "PMTiles",
        "MBTiles",
        "TileJSON",
        "geometry mutation",
    },
    "cplayout_qa_validation_reviewer": {
        "validation triage",
        "acceptance gate",
        "test gap",
        "proof gate",
        "audit finding",
        "regression evidence",
        "release evidence",
    },
}

REQUIRED_CONTEXT_PACK_IDS = {
    "workspace_preflight",
    "governance_hooks_skills",
    "interface_ui",
    "geometry_design",
    "core_project_geometry",
    "storage_archive_native",
    "imagery_kml_evidence",
    "cornergpsmap_bpf",
    "runtime_proof_gates",
    "gis_geometry_guardrails",
    "qa_validation_evidence",
}

HOOK_SAMPLES = (
    (
        "UserPromptSubmit",
        ".codex/hooks/cplayout_prompt_triage.py",
        {
            "hook_event_name": "UserPromptSubmit",
            "prompt": "Use Google Earth KML imagery and SQLite to plan a center pivot UI change.",
        },
    ),
    (
        "SubagentStart",
        ".codex/hooks/cplayout_subagent_start.py",
        {"hook_event_name": "SubagentStart", "agent_type": "cplayout_imagery_mapper"},
    ),
    (
        "PreToolUse advisory",
        ".codex/hooks/cplayout_pre_tool_use.py",
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": "echo Google Maps API key and WGS84 geometry"},
        },
    ),
    (
        "PreToolUse deny",
        ".codex/hooks/cplayout_pre_tool_use.py",
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": "git reset --hard HEAD"},
        },
    ),
)


STOP_DISABLED_SAMPLE = (
    "Stop disabled compatibility",
    ".codex/hooks/cplayout_stop_multi_agent.py",
    {
        "hook_event_name": "Stop",
        "stop_hook_active": False,
        "prompt": "Use multi-agent expert panels to review managed hook enforcement.",
        "last_assistant_message": "Implemented the change and ran tests.",
    },
)


def run(command: list[str], *, cwd: Path = ROOT) -> tuple[bool, str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    return result.returncode == 0, result.stdout.strip()


def validate_skills() -> list[str]:
    errors: list[str] = []
    if not QUICK_VALIDATE.exists():
        return [f"Missing skill validator: {QUICK_VALIDATE}"]

    skill_root = ROOT / ".agents" / "skills"
    for skill_md in sorted(skill_root.glob("*/SKILL.md")):
        ok, output = run([sys.executable, str(QUICK_VALIDATE), str(skill_md.parent)])
        label = skill_md.parent.relative_to(ROOT)
        print(f"[skill] {label}: {output}")
        if not ok:
            errors.append(f"{label}: {output}")
    return errors


def validate_toml() -> list[str]:
    errors: list[str] = []
    toml_paths = [ROOT / ".codex" / "config.toml"]
    toml_paths.extend(ROOT.glob(".codex/agents/*.toml"))
    toml_paths.extend(ROOT.glob("docs/examples/*.toml"))
    for path in sorted(toml_paths):
        try:
            tomllib.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - report parser detail.
            errors.append(f"{path.relative_to(ROOT)}: {exc}")
        else:
            print(f"[toml] {path.relative_to(ROOT)}: ok")
    return errors


def validate_hooks() -> list[str]:
    errors: list[str] = []
    hooks_path = ROOT / ".codex" / "hooks.json"
    try:
        hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report parser detail.
        return [f".codex/hooks.json: {exc}"]

    command = (
        hooks.get("hooks", {})
        .get("UserPromptSubmit", [{}])[0]
        .get("hooks", [{}])[0]
        .get("command", "")
    )
    if "cplayout_prompt_triage.py" not in command:
        errors.append(".codex/hooks.json: UserPromptSubmit command does not reference cplayout_prompt_triage.py")
    hook_config = hooks.get("hooks", {})
    configured_events = set(hook_config) if isinstance(hook_config, dict) else set()
    for event_name in ("UserPromptSubmit", "SubagentStart", "PreToolUse"):
        if event_name not in configured_events:
            errors.append(f".codex/hooks.json: missing {event_name} hook")
    if "Stop" in configured_events:
        errors.append(".codex/hooks.json: Stop hook must stay disabled to avoid continuation loops")

    pre_tool_entries = hook_config.get("PreToolUse", []) if isinstance(hook_config, dict) else []
    matcher = pre_tool_entries[0].get("matcher", "") if pre_tool_entries and isinstance(pre_tool_entries[0], dict) else ""
    if matcher != r"^(Bash|functions\.exec_command|apply_patch|Edit|Write|mcp__.*)$":
        errors.append(".codex/hooks.json: PreToolUse matcher does not cover expected tool names")
    try:
        managed_requirements = tomllib.loads(
            (ROOT / "docs" / "examples" / "cplayout-managed-requirements.toml").read_text(encoding="utf-8")
        )
    except Exception as exc:  # noqa: BLE001 - TOML parse is also reported elsewhere.
        errors.append(f"docs/examples/cplayout-managed-requirements.toml: {exc}")
    else:
        managed_pre_tool = managed_requirements.get("hooks", {}).get("PreToolUse", [])
        managed_matcher = (
            managed_pre_tool[0].get("matcher", "")
            if managed_pre_tool and isinstance(managed_pre_tool[0], dict)
            else ""
        )
        if managed_matcher != r"^(Bash|functions\.exec_command|apply_patch|Edit|Write|mcp__.*)$":
            errors.append("docs/examples/cplayout-managed-requirements.toml: PreToolUse matcher is not anchored")

    ok, output = run([sys.executable, str(ROOT / ".codex" / "hooks" / "cplayout_prompt_triage.py")])
    if not ok:
        errors.append(f"prompt triage empty-input run failed: {output}")

    for label, rel_script, sample in HOOK_SAMPLES:
        proc = subprocess.run(
            [sys.executable, str(ROOT / rel_script)],
            cwd=ROOT,
            input=json.dumps(sample),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if proc.returncode != 0:
            errors.append(f"{label} sample failed: {proc.stdout.strip()}")
            continue
        try:
            parsed = json.loads(proc.stdout)
            output = parsed["hookSpecificOutput"]
        except Exception as exc:  # noqa: BLE001 - report parser detail.
            errors.append(f"{label} sample output invalid: {exc}")
            continue
        if output.get("hookEventName") != sample["hook_event_name"]:
            errors.append(f"{label} sample has wrong hookEventName")
        if "deny" in label and output.get("permissionDecision") != "deny":
            errors.append(f"{label} sample did not deny destructive input")
        if "deny" not in label and not isinstance(output.get("additionalContext"), str):
            errors.append(f"{label} sample missing additionalContext")
        print(f"[hook] {label} sample: ok")

    for label, rel_script, sample in (STOP_DISABLED_SAMPLE,):
        proc = subprocess.run(
            [sys.executable, str(ROOT / rel_script)],
            cwd=ROOT,
            input=json.dumps(sample),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if proc.returncode != 0:
            errors.append(f"{label} sample failed: {proc.stdout.strip()}")
        elif proc.stdout.strip():
            errors.append(f"{label} sample produced unexpected output: {proc.stdout.strip()}")
        else:
            print(f"[hook] {label} sample: ok")

    return errors


def validate_route_data() -> list[str]:
    errors: list[str] = []
    route_path = ROOT / ".codex" / "hooks" / "cplayout_route_data.json"
    try:
        route_data = json.loads(route_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report parser detail.
        return [f"{route_path.relative_to(ROOT)}: {exc}"]

    if route_data.get("maxRoutes") != 3:
        errors.append("cplayout_route_data.json: maxRoutes must be 3")
    if not isinstance(route_data.get("minScore"), int):
        errors.append("cplayout_route_data.json: minScore must be an integer")
    if "defaultComplexityBand" in route_data or "defaultReasoningEffort" in route_data:
        errors.append("cplayout_route_data.json: hidden default complexity/reasoning fields are not allowed")
    for field in ("unmatchedComplexity", "unmatchedReasoningEffort"):
        value = route_data.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"cplayout_route_data.json: {field} must be a non-empty string")
    if not isinstance(route_data.get("baseValidationExpectations"), list):
        errors.append("cplayout_route_data.json: baseValidationExpectations must be a list")

    agent_names = set()
    for path in ROOT.glob(".codex/agents/*.toml"):
        try:
            parsed = tomllib.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - parser detail reported elsewhere too.
            errors.append(f"{path.relative_to(ROOT)}: {exc}")
            continue
        name = parsed.get("name")
        if isinstance(name, str):
            agent_names.add(name)

    route_ids: list[str] = []
    routes = route_data.get("routes")
    if not isinstance(routes, list):
        return ["cplayout_route_data.json: routes must be a list"]
    for route in routes:
        if not isinstance(route, dict):
            errors.append("cplayout_route_data.json: route must be an object")
            continue
        route_id = route.get("id")
        if isinstance(route_id, str):
            route_ids.append(route_id)
        skill = route.get("skill")
        if not isinstance(skill, str) or not (ROOT / ".agents" / "skills" / skill / "SKILL.md").exists():
            errors.append(f"cplayout_route_data.json: {route_id}.skill does not reference a local skill")
        agent = route.get("agent")
        if not isinstance(agent, str) or agent not in agent_names:
            errors.append(f"cplayout_route_data.json: {route_id}.agent does not reference a configured agent")
        if route.get("complexityBand") not in COMPLEXITY_BANDS:
            errors.append(f"cplayout_route_data.json: {route_id}.complexityBand is invalid")
        if route.get("reasoningEffort") not in REASONING_EFFORTS:
            errors.append(f"cplayout_route_data.json: {route_id}.reasoningEffort is invalid")
        if route.get("subagentReasoningEffort") not in SUBAGENT_REASONING_EFFORTS:
            errors.append(f"cplayout_route_data.json: {route_id}.subagentReasoningEffort must be task_selected")
        if route.get("spawnPolicy") not in SPAWN_POLICIES:
            errors.append(f"cplayout_route_data.json: {route_id}.spawnPolicy is invalid")
        for field in ("note", "routingReason"):
            value = route.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"cplayout_route_data.json: {route_id}.{field} must be non-empty")
        expectations = route.get("validationExpectations")
        if not isinstance(expectations, list) or not all(
            isinstance(expectation, str) and expectation.strip() for expectation in expectations
        ):
            errors.append(f"cplayout_route_data.json: {route_id}.validationExpectations must be non-empty strings")
        for field in ("positiveKeywords", "negativeKeywords"):
            keywords = route.get(field)
            if not isinstance(keywords, list):
                errors.append(f"cplayout_route_data.json: {route_id}.{field} must be a list")
                continue
            if (
                field == "positiveKeywords"
                and isinstance(route_id, str)
                and route_id in ROUTE_POSITIVE_KEYWORD_LIMITS
                and len(keywords) > ROUTE_POSITIVE_KEYWORD_LIMITS[route_id]
            ):
                errors.append(
                    "cplayout_route_data.json: "
                    f"{route_id}.positiveKeywords has {len(keywords)} entries; "
                    f"limit is {ROUTE_POSITIVE_KEYWORD_LIMITS[route_id]}"
                )
            if field == "positiveKeywords" and isinstance(route_id, str) and route_id in REQUIRED_ROUTE_KEYWORDS:
                terms = {
                    keyword.get("term")
                    for keyword in keywords
                    if isinstance(keyword, dict) and isinstance(keyword.get("term"), str)
                }
                missing_keywords = sorted(REQUIRED_ROUTE_KEYWORDS[route_id] - terms)
                for missing_keyword in missing_keywords:
                    errors.append(f"cplayout_route_data.json: {route_id}.positiveKeywords missing {missing_keyword}")
            for keyword in keywords:
                weight = keyword.get("weight") if isinstance(keyword, dict) else None
                if not isinstance(weight, int) or weight <= 0:
                    errors.append(f"cplayout_route_data.json: {route_id}.{field} has non-positive weight")

    duplicates = sorted({route_id for route_id in route_ids if route_ids.count(route_id) > 1})
    for duplicate in duplicates:
        errors.append(f"cplayout_route_data.json: duplicate route id {duplicate}")
    missing = sorted(REQUIRED_ROUTE_IDS - set(route_ids))
    for route_id in missing:
        errors.append(f"cplayout_route_data.json: missing required route id {route_id}")
    if not errors:
        print("[hook] cplayout_route_data.json: ok")
    return errors


def validate_context_map() -> list[str]:
    errors: list[str] = []
    ok, output = run([sys.executable, str(ROOT / "tools" / "build_cplayout_context_map.py"), "--check"])
    print("[context] context-map freshness: " + ("ok" if ok else output))
    if not ok:
        errors.append(f"context map check failed: {output}")
        return errors

    context_path = ROOT / ".codex" / "hooks" / "cplayout_context_map.json"
    try:
        context_map = json.loads(context_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report parser detail.
        return [f".codex/hooks/cplayout_context_map.json: {exc}"]

    if context_map.get("schemaVersion") != 1:
        errors.append("cplayout_context_map.json: schemaVersion must be 1")
    limits = context_map.get("limits")
    if not isinstance(limits, dict):
        errors.append("cplayout_context_map.json: limits must be an object")
        limits = {}
    max_packs = limits.get("maxContextPacksPerHook")
    if not isinstance(max_packs, int) or max_packs != 3:
        errors.append("cplayout_context_map.json: maxContextPacksPerHook must be 3")
    max_first_reads = limits.get("maxReadFirstPathsPerPack")
    if not isinstance(max_first_reads, int) or max_first_reads != 2:
        errors.append("cplayout_context_map.json: maxReadFirstPathsPerPack must be 2")
    max_pack_budget = limits.get("maxContextPackTokenBudget")
    if not isinstance(max_pack_budget, int) or max_pack_budget != 1200:
        errors.append("cplayout_context_map.json: maxContextPackTokenBudget must be 1200")
    max_governance_summary_chars = limits.get("maxGovernanceSummaryChars")
    if not isinstance(max_governance_summary_chars, int) or max_governance_summary_chars != 7000:
        errors.append("cplayout_context_map.json: maxGovernanceSummaryChars must be 7000")

    validation_commands = context_map.get("validationCommands")
    if not isinstance(validation_commands, dict):
        errors.append("cplayout_context_map.json: validationCommands must be an object")
        validation_commands = {}

    hard_vetoes = context_map.get("hardVetoes")
    hard_veto_ids: set[object] = set()
    if isinstance(hard_vetoes, list):
        hard_veto_ids = {veto.get("id") for veto in hard_vetoes if isinstance(veto, dict)}
    if "hooks_are_advisory" not in hard_veto_ids or "stop_hook_disabled" not in hard_veto_ids:
        errors.append("cplayout_context_map.json: required hard vetoes are missing")

    route_path = ROOT / ".codex" / "hooks" / "cplayout_route_data.json"
    route_data = json.loads(route_path.read_text(encoding="utf-8"))
    route_ids = {
        route.get("id")
        for route in route_data.get("routes", [])
        if isinstance(route, dict) and isinstance(route.get("id"), str)
    }
    agent_names = set()
    for path in ROOT.glob(".codex/agents/*.toml"):
        parsed = tomllib.loads(path.read_text(encoding="utf-8"))
        name = parsed.get("name")
        if isinstance(name, str):
            agent_names.add(name)

    packs = context_map.get("contextPacks")
    if not isinstance(packs, list):
        errors.append("cplayout_context_map.json: contextPacks must be a list")
        packs = []
    pack_ids: list[str] = []
    for pack in packs:
        if not isinstance(pack, dict):
            errors.append("cplayout_context_map.json: context pack must be an object")
            continue
        pack_id = pack.get("id")
        if isinstance(pack_id, str):
            pack_ids.append(pack_id)
        else:
            errors.append("cplayout_context_map.json: context pack id must be a string")
            pack_id = "<unknown>"
        for field, max_key in (
            ("readFirstPaths", "maxReadFirstPathsPerPack"),
            ("secondaryPaths", "maxSecondaryPathsPerPack"),
        ):
            values = pack.get(field)
            max_count = limits.get(max_key, 0)
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                errors.append(f"cplayout_context_map.json: {pack_id}.{field} must be a string list")
                continue
            if isinstance(max_count, int) and len(values) > max_count:
                errors.append(f"cplayout_context_map.json: {pack_id}.{field} exceeds {max_key}")
            for relpath in values:
                if relpath.startswith("/") or relpath.startswith("~") or "\\" in relpath:
                    errors.append(f"cplayout_context_map.json: {pack_id}.{field} has non-relative path {relpath}")
                if relpath.startswith("reports/") or relpath.startswith("tmp/"):
                    errors.append(f"cplayout_context_map.json: {pack_id}.{field} references raw local artifact {relpath}")
                if not (ROOT / relpath).exists():
                    errors.append(f"cplayout_context_map.json: {pack_id}.{field} missing path {relpath}")
        command_ids = pack.get("validationCommandIds")
        max_commands = limits.get("maxValidationCommandsPerPack", 0)
        if not isinstance(command_ids, list) or not all(isinstance(value, str) for value in command_ids):
            errors.append(f"cplayout_context_map.json: {pack_id}.validationCommandIds must be a string list")
        else:
            if isinstance(max_commands, int) and len(command_ids) > max_commands:
                errors.append(f"cplayout_context_map.json: {pack_id}.validationCommandIds exceeds maxValidationCommandsPerPack")
            for command_id in command_ids:
                if command_id not in validation_commands:
                    errors.append(f"cplayout_context_map.json: {pack_id}.validationCommandIds unknown {command_id}")
        token_budget = pack.get("tokenBudget")
        if not isinstance(token_budget, int) or token_budget <= 0:
            errors.append(f"cplayout_context_map.json: {pack_id}.tokenBudget must be a positive integer")
        elif isinstance(max_pack_budget, int) and token_budget > max_pack_budget:
            errors.append(f"cplayout_context_map.json: {pack_id}.tokenBudget exceeds maxContextPackTokenBudget")

    missing_packs = sorted(REQUIRED_CONTEXT_PACK_IDS - set(pack_ids))
    for missing_pack in missing_packs:
        errors.append(f"cplayout_context_map.json: missing required context pack {missing_pack}")
    duplicate_packs = sorted({pack_id for pack_id in pack_ids if pack_ids.count(pack_id) > 1})
    for duplicate_pack in duplicate_packs:
        errors.append(f"cplayout_context_map.json: duplicate context pack {duplicate_pack}")

    route_context = context_map.get("routeContext")
    if not isinstance(route_context, dict):
        errors.append("cplayout_context_map.json: routeContext must be an object")
        route_context = {}
    for route_id in sorted(route_ids):
        refs = route_context.get(route_id)
        if not isinstance(refs, list) or not refs:
            errors.append(f"cplayout_context_map.json: routeContext missing {route_id}")
        elif isinstance(max_packs, int) and len(refs) > max_packs:
            errors.append(f"cplayout_context_map.json: routeContext {route_id} exceeds maxContextPacksPerHook")
    agent_context = context_map.get("agentContext")
    if not isinstance(agent_context, dict):
        errors.append("cplayout_context_map.json: agentContext must be an object")
        agent_context = {}
    for agent_name in sorted(agent_names):
        refs = agent_context.get(agent_name)
        if not isinstance(refs, list) or not refs:
            errors.append(f"cplayout_context_map.json: agentContext missing {agent_name}")
        elif isinstance(max_packs, int) and len(refs) > max_packs:
            errors.append(f"cplayout_context_map.json: agentContext {agent_name} exceeds maxContextPacksPerHook")

    source_hashes = context_map.get("sourceHashes")
    if not isinstance(source_hashes, dict) or "AGENTS.md" not in source_hashes:
        errors.append("cplayout_context_map.json: sourceHashes must include AGENTS.md")
    for required_hash in ("docs/README.md", "docs/agent-tree-protocol.md", "docs/agent-tree-rollout.md"):
        if not isinstance(source_hashes, dict) or required_hash not in source_hashes:
            errors.append(f"cplayout_context_map.json: sourceHashes must include {required_hash}")

    governance_summary_path = ROOT / "docs" / "agent-governance-summary.md"
    if governance_summary_path.exists() and isinstance(max_governance_summary_chars, int):
        summary_text = governance_summary_path.read_text(encoding="utf-8")
        if len(summary_text) > max_governance_summary_chars:
            errors.append("docs/agent-governance-summary.md: exceeds maxGovernanceSummaryChars")
        if "This is the compact first-read entrypoint" not in summary_text:
            errors.append("docs/agent-governance-summary.md: missing compact first-read marker")

    if not errors:
        print("[context] cplayout_context_map.json: ok")
    return errors


def validate_hook_tests() -> list[str]:
    ok, output = run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tools/tests", "-p", "test_cplayout_*.py"]
    )
    print("[test] tools/tests/test_cplayout_*.py: " + ("ok" if ok else output))
    return [] if ok else [f"hook unit tests failed: {output}"]


def validate_required_files() -> list[str]:
    errors: list[str] = []
    for relpath in REQUIRED_AGENT_FILES + REQUIRED_DOCS:
        if not (ROOT / relpath).exists():
            errors.append(f"Missing required file: {relpath}")
        else:
            print(f"[file] {relpath}: ok")
    return errors


def validate_ge_inventory_help() -> list[str]:
    script = (
        ROOT
        / ".agents"
        / "skills"
        / "cplayout-google-earth-imagery-analysis"
        / "scripts"
        / "inventory_ge_artifacts.py"
    )
    if not script.exists():
        return [f"Missing Google Earth inventory helper: {script.relative_to(ROOT)}"]
    ok, output = run([sys.executable, str(script), "--help"])
    print("[helper] inventory_ge_artifacts.py --help: " + ("ok" if ok else output))
    return [] if ok else [f"inventory_ge_artifacts.py --help failed: {output}"]


def validate_gitignore_boundaries() -> list[str]:
    gitignore = ROOT / ".gitignore"
    text = gitignore.read_text(encoding="utf-8")
    required = "reports/cornergps-flt-inventory/"
    print(f"[gitignore] {required}: " + ("ok" if required in text else "missing"))
    return [] if required in text else [f".gitignore must ignore {required}"]


def main() -> int:
    errors: list[str] = []
    errors.extend(validate_required_files())
    errors.extend(validate_skills())
    errors.extend(validate_toml())
    errors.extend(validate_route_data())
    errors.extend(validate_context_map())
    errors.extend(validate_hooks())
    errors.extend(validate_hook_tests())
    errors.extend(validate_ge_inventory_help())
    errors.extend(validate_gitignore_boundaries())

    if errors:
        print("\nValidation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("\nCPLayout skill and agent validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
