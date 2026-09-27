#!/usr/bin/env python3
"""Inject CPLayout repository boundaries into spawned subagents."""

from __future__ import annotations

import json
import hashlib
import re
import sys
import tomllib
from pathlib import Path


def _repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "AGENTS.md").exists() and (candidate / ".codex" / "agents").exists():
            return candidate
    return Path(__file__).resolve().parents[2]


ROOT = _repo_root(Path.cwd())
AGENT_DIR = ROOT / ".codex" / "agents"
CONTEXT_MAP_FILENAME = "cplayout_context_map.json"
SUBAGENT_CONTEXT_MAX_BYTES = 900
AUTHORITY_PATHS = (
    "AGENTS.md",
    "docs/agent-tree-protocol.md",
    ".codex/config.toml",
    ".codex/hooks/cplayout_route_data.json",
    ".codex/hooks/cplayout_subagent_start.py",
    "tools/build_cplayout_context_map.py",
)


def _read_payload() -> dict[str, object]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _agent_config(agent_type: object) -> tuple[Path, dict[str, object]] | None:
    if not isinstance(agent_type, str) or not agent_type.strip():
        return None
    requested = agent_type.strip()
    for path in sorted(AGENT_DIR.glob("*.toml")):
        try:
            config = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError):
            continue
        name = config.get("name")
        if name == requested or path.stem == requested:
            return path, config
    return None


def _context_map_path() -> Path | None:
    repo_path = ROOT / ".codex" / "hooks" / CONTEXT_MAP_FILENAME
    if repo_path.exists():
        return repo_path
    managed_path = Path(__file__).with_name(CONTEXT_MAP_FILENAME)
    return managed_path if managed_path.exists() else None


def _source_hash_matches(context_map: dict[str, object], relative: str) -> bool:
    hashes = context_map.get("sourceHashes")
    expected = hashes.get(relative) if isinstance(hashes, dict) else None
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        return False
    source = (ROOT / relative).resolve()
    if not source.is_relative_to(ROOT) or not source.is_file():
        return False
    try:
        return hashlib.sha256(source.read_bytes()).hexdigest() == expected
    except OSError:
        return False


def _load_context_map() -> dict[str, object] | None:
    path = _context_map_path()
    if path is None:
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict) or parsed.get("schemaVersion") != 1:
        return None
    if not isinstance(parsed.get("contextPacks"), list) or not isinstance(parsed.get("agentContext"), dict):
        return None
    hashes = parsed.get("sourceHashes")
    if not isinstance(hashes, dict) or not hashes:
        return None
    if not all(_source_hash_matches(parsed, relative) for relative in AUTHORITY_PATHS):
        return None
    return parsed


def _context_pack_lookup(context_map: dict[str, object]) -> dict[str, dict[str, object]]:
    packs: dict[str, dict[str, object]] = {}
    raw_packs = context_map.get("contextPacks")
    if not isinstance(raw_packs, list):
        return packs
    for raw_pack in raw_packs:
        if not isinstance(raw_pack, dict):
            continue
        pack_id = raw_pack.get("id")
        if isinstance(pack_id, str) and pack_id:
            packs[pack_id] = raw_pack
    return packs


def _context(payload: dict[str, object]) -> str:
    agent_type = payload.get("agent_type")
    loaded = _agent_config(agent_type)
    lines = ["CPLayout subagent advisory:"]
    if loaded is None:
        lines.append("Profile: no matching custom agent; use the coordinator-assigned scope.")
    else:
        lines.append(f"Profile: {loaded[0].relative_to(ROOT)}; use the coordinator-assigned scope.")
    context_map = _load_context_map()
    pack_ids: list[str] = []
    leaf_path: str | None = None
    if context_map is not None and isinstance(agent_type, str):
        agent_context = context_map.get("agentContext")
        raw_ids = agent_context.get(agent_type) if isinstance(agent_context, dict) else None
        packs = _context_pack_lookup(context_map)
        if isinstance(raw_ids, list):
            pack_ids = [pack_id for pack_id in raw_ids if isinstance(pack_id, str) and pack_id in packs][:3]
            leaf_path = next(
                (
                    path
                    for pack_id in pack_ids
                    if pack_id != "workspace_preflight"
                    for path in (packs[pack_id].get("readFirstPaths") if isinstance(packs[pack_id].get("readFirstPaths"), list) else [])
                    if isinstance(path, str) and path != "AGENTS.md" and _source_hash_matches(context_map, path)
                ),
                None,
            )
    lines.append("Read first: AGENTS.md" + (f"; {leaf_path}." if leaf_path else "."))
    if pack_ids:
        lines.append(f"Context packs: {', '.join(pack_ids)}.")
    lines.extend((
        "Check git status; preserve other work and keep assigned scopes separate.",
        "Offline/no-cost; projected/local XY is canonical, WGS84 input/display; KML/KMZ styling is visual-only.",
        "Google Earth, native MapLibre, SQLite, and ZIP runtime claims require direct checklist evidence.",
        "Hooks are advisory, not enforcement.",
    ))
    output = "\n".join(lines)
    if len(output.encode("utf-8")) > SUBAGENT_CONTEXT_MAX_BYTES:
        return "CPLayout subagent advisory: read AGENTS.md; follow the coordinator-assigned scope. Offline/no-cost; projected/local XY canonical; KML/KMZ styling visual-only; runtime proof needs direct evidence. Hooks are advisory."
    return output


def main() -> int:
    payload = _read_payload()
    if payload.get("hook_event_name") not in (None, "SubagentStart"):
        return 0
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "SubagentStart",
                    "additionalContext": _context(payload),
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
