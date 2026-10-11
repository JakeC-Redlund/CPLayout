from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOK_DIR = ROOT / '.codex/hooks'
spec = importlib.util.spec_from_file_location('advisory_failures_triage', HOOK_DIR / 'cplayout_prompt_triage.py')
assert spec and spec.loader
triage = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = triage
spec.loader.exec_module(triage)


class AdvisoryFailureContracts(unittest.TestCase):
    def test_bad_or_missing_route_data_has_private_bounded_fallback(self) -> None:
        for route_text in [None, '{synthetic-private-value', '[]', '{}', json.dumps({'maxRoutes': True})]:
            with self.subTest(route_text=route_text), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                hooks = root / '.codex/hooks'
                hooks.mkdir(parents=True)
                shutil.copyfile(HOOK_DIR / 'cplayout_prompt_triage.py', hooks / 'cplayout_prompt_triage.py')
                if route_text is not None:
                    (hooks / 'cplayout_route_data.json').write_text(route_text)
                nested = root / 'nested/path'
                nested.mkdir(parents=True)
                p = subprocess.run([sys.executable, '-B', str(hooks / 'cplayout_prompt_triage.py')], cwd=nested, input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': 'synthetic-private-value', 'transcript_path': 'synthetic-private-value'}), capture_output=True, text=True, check=False)
                self.assertEqual(p.returncode, 0, p.stderr)
                context = json.loads(p.stdout)['hookSpecificOutput']['additionalContext']
                self.assertLessEqual(len(context.encode('utf-8')), 1200)
                self.assertIn('current user task', context)
                self.assertNotIn('synthetic-private-value', p.stdout + p.stderr)
                self.assertNotIn('AGENTS.md', context)
                self.assertEqual(p.stderr, '')

    def test_wrong_event_is_silent_even_without_route_data(self) -> None:
        for script in ['cplayout_prompt_triage.py', 'cplayout_subagent_start.py', 'cplayout_pre_tool_use.py', 'cplayout_stop_multi_agent.py']:
            with self.subTest(script=script):
                p = subprocess.run([sys.executable, '-B', str(HOOK_DIR / script)], cwd=ROOT, input=json.dumps({'hook_event_name': 'Interrupt', 'prompt': 'Use agents and git reset --hard synthetic-private-value'}), text=True, capture_output=True, check=False)
                self.assertEqual((p.returncode, p.stdout, p.stderr), (0, '', ''))

    def test_normalized_keyword_duplicates_and_boolean_weights_rejected(self) -> None:
        for keywords in [[{'term': 'mode-switch', 'weight': 12}, {'term': 'mode switch', 'weight': 9}], [{'term': 'mode switch', 'weight': True}]]:
            with self.subTest(keywords=keywords), self.assertRaises(ValueError):
                triage._keywords(keywords)

    def test_duplicate_route_ids_and_bad_route_limits_rejected(self) -> None:
        source = json.loads((HOOK_DIR / 'cplayout_route_data.json').read_text())
        for field, value in [('maxRoutes', 4), ('maxRoutes', True), ('minScore', True), ('routes', source['routes'] + [source['routes'][0]])]:
            data = dict(source)
            data[field] = value
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / 'routes.json'
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    triage.load_route_data(path)

    def test_precise_unified_routes_and_preservation_risks(self) -> None:
        for prompt in ['Unify Design Survey Layout in one workspace.', 'Preserve dirty input and camera retention during a mode switch.', 'Keep receiver ownership during a mode toggle and use a shared map.']:
            with self.subTest(prompt=prompt):
                self.assertEqual(triage.match_routes(prompt)[0].route.route_id, 'cplayout_interface_developer')
        self.assertEqual(triage.match_routes('Persist survey collection in a complete workspace bundle.')[0].route.route_id, 'cplayout_database_specialist')
        self.assertEqual(triage.match_routes('Preserve the immutable layout target.')[0].route.route_id, 'cplayout_gis_geometry_guardian')
        for prompt in ['design', 'survey', 'layout', 'switchboard', 'camera-ready', 'receiver']:
            with self.subTest(prompt=prompt):
                self.assertEqual(triage.match_routes(prompt), [])

    def test_history_copy_is_exact_and_active_instruction_does_not_reinstate_it(self) -> None:
        evidence = json.loads((ROOT / 'docs/governance-refocus-evidence-2026-10-10.json').read_text())
        archive = ROOT / 'docs/archive/agents-before-refocus-2026-10-10.md'
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), evidence['original_hashes']['AGENTS.md'])
        active = (ROOT / 'AGENTS.md').read_text()
        self.assertIn('withdrew', active)
        self.assertNotIn('Hard Constraints', active)
        self.assertLess(len(active.encode('utf-8')), 1600)


if __name__ == '__main__':
    unittest.main()
