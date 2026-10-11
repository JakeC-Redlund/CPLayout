#!/usr/bin/env python3
"""Compatibility no-op for the disabled CPLayout Stop hook.

The Stop continuation path was disabled because stale or ambiguous runtime
payloads could produce repeated continuation prompts. Subagent accounting stays
documented in current coordinator assignments and prompt-triage context, but this script must not
block or continue a turn.
"""

from __future__ import annotations

import json
import re
import sys
import importlib.util
from pathlib import Path
from typing import Any


TOKEN_RE = re.compile(r"[a-z0-9_]+")
EXPLICIT_MULTI_AGENT_TERMS = (
    "multi-agent",
    "multi agent",
    "subagent",
    "subagents",
    "expert panel",
    "expert panels",
    "expert-agent panel",
    "expert-agent panels",
    "agent panel",
    "agent panels",
    "parallel agent",
    "parallel agents",
    "spawn agent",
    "spawn agents",
    "specialist team",
    "specialist teams",
    "delegate to agents",
)
DECISION_RE = re.compile(
    r"\b(?:Subagent decision|Accepted fallback)\s*:",
    re.IGNORECASE,
)
STOP_CONTINUATION_ENABLED = False


def _read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}
    return parsed if isinstance(parsed, dict) else {}


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(TOKEN_RE.findall(text.lower()))


def _has_phrase(text: str, phrase: str) -> bool:
    text_tokens = _tokens(text)
    phrase_tokens = _tokens(phrase)
    if not phrase_tokens or len(phrase_tokens) > len(text_tokens):
        return False
    phrase_len = len(phrase_tokens)
    return any(text_tokens[index : index + phrase_len] == phrase_tokens for index in range(len(text_tokens)))


def _flatten_text(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        texts: list[str] = []
        for item in value.values():
            texts.extend(_flatten_text(item))
        return texts
    if isinstance(value, list):
        texts = []
        for item in value:
            texts.extend(_flatten_text(item))
        return texts
    return []


def _field_text(payload: dict[str, Any], field_names: tuple[str, ...]) -> str | None:
    for field_name in field_names:
        if field_name not in payload:
            continue
        text = "\n".join(_flatten_text(payload[field_name])).strip()
        if text:
            return text
    return None


def _message_role(message: dict[str, Any]) -> str:
    role = message.get("role") or message.get("author") or message.get("sender")
    if isinstance(role, dict):
        role = role.get("role") or role.get("name")
    return str(role).lower() if role is not None else ""


def _message_text(message: dict[str, Any]) -> str:
    for field_name in ("content", "text", "message"):
        if field_name in message:
            text = "\n".join(_flatten_text(message[field_name])).strip()
            if text:
                return text
    return "\n".join(_flatten_text(message)).strip()


def _iter_role_messages(payload: dict[str, Any]) -> list[tuple[str, str]]:
    messages: list[tuple[str, str]] = []
    for field_name in ("messages", "transcript", "conversation"):
        value = payload.get(field_name)
        if not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            role = _message_role(item)
            if role not in {"user", "assistant"}:
                continue
            text = _message_text(item)
            if text:
                messages.append((role, text))
    return messages


def _latest_role_text(payload: dict[str, Any], role: str) -> str | None:
    for message_role, text in reversed(_iter_role_messages(payload)):
        if message_role == role:
            return text
    return None


def _latest_user_prompt(payload: dict[str, Any]) -> str | None:
    return _field_text(payload, ("prompt", "user_prompt", "last_user_message")) or _latest_role_text(payload, "user")


def _latest_assistant_message(payload: dict[str, Any]) -> str | None:
    return _field_text(
        payload,
        (
            "last_assistant_message",
            "response",
            "assistant_response",
            "final_response",
            "last_agent_message",
        ),
    ) or _latest_role_text(payload, "assistant")


def has_explicit_multi_agent_request(text: str) -> bool:
    return any(_has_phrase(text, phrase) for phrase in EXPLICIT_MULTI_AGENT_TERMS)


def has_subagent_decision(text: str) -> bool:
    return bool(DECISION_RE.search(text))


def has_matched_cplayout_route(text: str) -> bool:
    if not text.strip():
        return False
    triage_path = Path(__file__).with_name("cplayout_prompt_triage.py")
    spec = importlib.util.spec_from_file_location("cplayout_prompt_triage_for_stop", triage_path)
    if spec is None or spec.loader is None:
        return False
    triage = importlib.util.module_from_spec(spec)
    try:
        sys.modules[spec.name] = triage
        spec.loader.exec_module(triage)
        return bool(triage.match_routes(text))
    except Exception:  # noqa: BLE001 - Stop hook must stay advisory/non-fatal.
        return False


def _continuation_reason() -> str:
    return "\n".join(
        [
            "CPLayout Stop hook continuation:",
            "Explicit multi-agent request or matched CPLayout specialist prompt ended without auditable subagent accounting.",
            "Continue the turn with either `Subagent decision: required/optional/not useful` plus specialist summary, or `Accepted fallback:` plus why local coordinator-only handling is acceptable.",
            "Keep the explanation source-backed; hooks remain advisory unless installed through managed requirements.toml and verified after restart.",
        ]
    )


def main() -> int:
    payload = _read_payload()
    if payload.get("hook_event_name") not in (None, "Stop"):
        return 0
    if not STOP_CONTINUATION_ENABLED:
        return 0
    if payload.get("stop_hook_active") is True:
        return 0

    prompt_text = _latest_user_prompt(payload)
    final_text = _latest_assistant_message(payload)
    if not prompt_text or not final_text:
        return 0

    prompt_requires_decision = has_explicit_multi_agent_request(prompt_text) or has_matched_cplayout_route(prompt_text)
    if prompt_requires_decision and not has_subagent_decision(final_text):
        print(
            json.dumps(
                {
                    "decision": "block",
                    "reason": _continuation_reason(),
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
