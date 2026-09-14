from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("context_builder_guardrails", ROOT / "tools/build_cplayout_context_map.py")
assert spec and spec.loader
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class GuardrailTests(unittest.TestCase):
    def hook(self, tool: str, tool_input: object) -> dict:
        result = subprocess.run(
            [sys.executable, str(ROOT / ".codex/hooks/cplayout_pre_tool_use.py")],
            input=json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input}),
            text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def test_shell_guard_does_not_interpret_patch_or_mcp_text_as_commands(self) -> None:
        command = "git reset --hard HEAD"
        for tool, payload in [("Bash", {"command": command}), ("exec_command", {"cmd": command})]:
            self.assertEqual(self.hook(tool, payload)["hookSpecificOutput"]["permissionDecision"], "deny")
        for tool in ["apply_patch", "mcp__notes__write"]:
            self.assertNotEqual(self.hook(tool, {"text": f"Never run {command}."}).get("hookSpecificOutput", {}).get("permissionDecision"), "deny")
        self.assertEqual(self.hook("Bash", {"cmd": [command]}), {})

    def test_weight_validation_rejects_nonfinite_negative_duplicate_and_boolean_values(self) -> None:
        baseline = builder._build_context_map()
        for value in [float("nan"), float("inf"), -1, True]:
            candidate = copy.deepcopy(baseline)
            weights = next(iter(candidate["panelProfiles"].values()))["weights"]
            weights[0]["weight"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                builder._validate_context_map(candidate)
        candidate = copy.deepcopy(baseline)
        weights = next(iter(candidate["panelProfiles"].values()))["weights"]
        weights[1]["role"] = weights[0]["role"]
        with self.assertRaises(ValueError):
            builder._validate_context_map(candidate)

    def test_governance_hashes_cover_actual_hook_inputs(self) -> None:
        hashes = builder._source_hashes()
        for path in [".codex/config.toml", ".codex/hooks/cplayout_pre_tool_use.py", ".codex/hooks/cplayout_stop_multi_agent.py"]:
            self.assertIn(path, hashes)


if __name__ == "__main__":
    unittest.main()
