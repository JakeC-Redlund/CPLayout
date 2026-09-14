#!/usr/bin/env python3
"""Advisory CPLayout PreToolUse guardrails.

This hook narrowly denies obviously destructive commands and otherwise returns
model-visible context for CPLayout boundaries. It is not a complete policy
enforcement boundary.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any


DENY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bgit\s+reset\s+--hard\b", re.IGNORECASE), "git reset --hard is destructive."),
    (re.compile(r"\bgit\s+clean\b(?=[^\n]*-[^\n]*f)(?=[^\n]*-[^\n]*d)", re.IGNORECASE), "git clean -fd removes untracked files."),
    (re.compile(r"\bgit\s+push\b(?=[^\n]*(?:--force|-f\b))", re.IGNORECASE), "force-push requires explicit user approval."),
    (re.compile(r"\bgit\s+push\b[^\n]*\s\+\S+", re.IGNORECASE), "force-push refspec requires explicit user approval."),
    (re.compile(r"\bnpm\s+audit\s+fix\b(?=[^\n]*--force\b)", re.IGNORECASE), "npm audit fix --force can introduce breaking changes."),
)

ADVISORY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\b(google maps|mapbox|esri|arcgis|paid imagery|paid cloud|api[_ -]?key|secret|token)\b", re.IGNORECASE),
        "CPLayout must remain no-cost/offline-first: avoid paid map APIs, paid imagery, cloud backends, hidden keys, secrets, or tokens.",
    ),
    (
        re.compile(r"\b(wgs84|lat(?:itude)?|lon(?:gitude)?|geometry|vertices|project crs|projected|xy)\b", re.IGNORECASE),
        "Canonical project geometry stays projected/local XY; WGS84 is input/display unless a schema change explicitly says otherwise.",
    ),
    (
        re.compile(r"\b(kml|kmz|styleurl|linestyle|polystyle|iconstyle|labelstyle|google earth|visual fidelity|render proof)\b", re.IGNORECASE),
        "KML/KMZ styling is visual interchange metadata only; do not claim Google Earth render proof without direct visual evidence.",
    ),
    (
        re.compile(r"\b-LeaveGoogleEarthOpen\b|\bLeaveGoogleEarthOpen\b", re.IGNORECASE),
        "Google Earth automation must clean up the targeted session unless -LeaveGoogleEarthOpen is explicit and reported.",
    ),
    (
        re.compile(r"\b(production[- ]verified|runtime proof|device[- ]verified|native verified|proven on android|proven on ios)\b", re.IGNORECASE),
        "Do not claim native/runtime proof without the relevant device, emulator, or Google Earth evidence checklist.",
    ),
)


def _read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _tool_text(payload: dict[str, Any]) -> str:
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        command = tool_input.get("command")
        if isinstance(command, str):
            return command
        return json.dumps(tool_input, sort_keys=True)
    if isinstance(tool_input, str):
        return tool_input
    return json.dumps(tool_input, sort_keys=True) if tool_input is not None else ""


def _shell_command(payload: dict[str, Any]) -> str | None:
    if payload.get("tool_name") not in {"Bash", "exec_command", "functions.exec_command", "shell", "shell_command"}:
        return None
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    command = tool_input.get("command", tool_input.get("cmd"))
    return command if isinstance(command, str) else None


def _deny_reason(text: str) -> str | None:
    for pattern, reason in DENY_PATTERNS:
        if pattern.search(text):
            return reason
    return None


def _advisory_context(text: str) -> str | None:
    messages: list[str] = []
    for pattern, message in ADVISORY_PATTERNS:
        if pattern.search(text) and message not in messages:
            messages.append(message)
    if not messages:
        return None
    return "CPLayout PreToolUse advisory:\n" + "\n".join(f"- {message}" for message in messages)


def main() -> int:
    payload = _read_payload()
    if payload.get("hook_event_name") not in (None, "PreToolUse"):
        return 0

    text = _tool_text(payload)
    command = _shell_command(payload)
    reason = _deny_reason(command) if command is not None else None
    if reason:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )
        return 0

    context = _advisory_context(text)
    if context:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "additionalContext": context,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
