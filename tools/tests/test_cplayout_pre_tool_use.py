from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / '.codex/hooks/cplayout_pre_tool_use.py'
spec = importlib.util.spec_from_file_location('pretool_contract', HOOK)
assert spec and spec.loader
pretool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pretool)


class PreToolContracts(unittest.TestCase):
    def invoke(self, payload: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, '-B', str(HOOK)], input=json.dumps(payload), text=True, capture_output=True, cwd=ROOT, check=False)

    def test_real_destructive_commands_are_denied_in_supported_forms(self) -> None:
        for name, key in [('Bash', 'command'), ('exec_command', 'cmd'), ('functions.exec_command', 'cmd')]:
            for command in ['git reset --hard HEAD', 'git clean -fd', 'git push --force origin main', 'git push origin +main', 'npm audit fix --force', 'echo ready && git reset --hard HEAD']:
                with self.subTest(name=name, command=command):
                    p = self.invoke({'hook_event_name': 'PreToolUse', 'tool_name': name, 'tool_input': {key: command}})
                    self.assertEqual(p.returncode, 0, p.stderr)
                    self.assertEqual(json.loads(p.stdout)['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_quoted_documentation_and_comments_are_not_destructive_execution(self) -> None:
        for command in ["echo 'git reset --hard HEAD'", 'echo git reset --hard HEAD', 'git status # git reset --hard HEAD', "printf '%s' 'npm audit fix --force'"]:
            with self.subTest(command=command):
                p = self.invoke({'tool_name': 'Bash', 'tool_input': {'command': command}})
                self.assertNotIn('permissionDecision', p.stdout)

    def test_advisory_is_bounded_and_never_echoes_private_input(self) -> None:
        sentinel = 'synthetic-private-value-DO-NOT-RETAIN'
        p = self.invoke({'tool_name': 'mcp__fixture__review', 'tool_input': {'text': sentinel + ' Google Maps API key WGS84 geometry KML Google Earth -LeaveGoogleEarthOpen runtime proof native verified ' * 500}})
        context = json.loads(p.stdout)['hookSpecificOutput']['additionalContext']
        self.assertLessEqual(len(context.encode('utf-8')), 600)
        self.assertNotIn(sentinel, p.stdout + p.stderr)

    def test_wrong_events_and_malformed_payload_are_silent(self) -> None:
        for payload in [{'hook_event_name': 'Interrupt', 'tool_name': 'Bash', 'tool_input': {'command': 'git reset --hard HEAD'}}, [], None, {}]:
            with self.subTest(payload=payload):
                p = self.invoke(payload)
                self.assertEqual((p.returncode, p.stdout, p.stderr), (0, '', ''))

    def test_non_shell_tool_text_cannot_trigger_shell_denial(self) -> None:
        p = self.invoke({'tool_name': 'apply_patch', 'tool_input': {'command': 'Document git reset --hard HEAD'}})
        self.assertNotIn('permissionDecision', p.stdout)


if __name__ == '__main__':
    unittest.main()
