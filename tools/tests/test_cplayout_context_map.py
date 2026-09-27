from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
CONTEXT_MAP_PATH = ROOT / ".codex" / "hooks" / "cplayout_context_map.json"
CONTEXT_DOC_PATH = ROOT / "docs" / "agent-context-map.md"
BUILDER_PATH = ROOT / "tools" / "build_cplayout_context_map.py"
TRIAGE_PATH = ROOT / ".codex" / "hooks" / "cplayout_prompt_triage.py"
SUBAGENT_START_PATH = ROOT / ".codex" / "hooks" / "cplayout_subagent_start.py"

spec = importlib.util.spec_from_file_location("cplayout_prompt_triage_context_tests", TRIAGE_PATH)
assert spec is not None and spec.loader is not None
triage = importlib.util.module_from_spec(spec)
sys.modules["cplayout_prompt_triage_context_tests"] = triage
spec.loader.exec_module(triage)

builder_spec = importlib.util.spec_from_file_location("cplayout_context_map_builder_tests", BUILDER_PATH)
assert builder_spec is not None and builder_spec.loader is not None
builder = importlib.util.module_from_spec(builder_spec)
builder_spec.loader.exec_module(builder)


class ContextMapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.context_map = json.loads(CONTEXT_MAP_PATH.read_text(encoding="utf-8"))

    def pack_ids_for_prompt(self, prompt: str) -> list[str]:
        matches = triage.match_routes(prompt)
        return [
            pack["id"]
            for pack in triage.context_packs_for_matches(prompt, matches, self.context_map)
            if isinstance(pack.get("id"), str)
        ]

    def hook_context(self, prompt: str, context_map: dict[str, object] | None = None) -> str:
        return triage._context(prompt, triage.match_routes(prompt), False, context_map)  # noqa: SLF001

    def test_context_map_check_command_passes(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "build_cplayout_context_map.py"), "--check"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("up to date", result.stdout)

    def test_required_schema_and_packs_exist(self) -> None:
        self.assertEqual(self.context_map["schemaVersion"], 1)
        pack_ids = {pack["id"] for pack in self.context_map["contextPacks"]}
        self.assertTrue(
            {
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
            }.issubset(pack_ids)
        )
        self.assertIn("cplayout_kb_curator", self.context_map["routeContext"])
        self.assertIn("cplayout_kb_curator", self.context_map["agentContext"])
        self.assertIn("cplayout_runtime_proof_gatekeeper", self.context_map["routeContext"])
        self.assertIn("cplayout_gis_geometry_guardian", self.context_map["agentContext"])
        self.assertIn("cplayout_qa_validation_reviewer", self.context_map["agentContext"])

    def test_context_pack_paths_exist_and_avoid_raw_artifacts(self) -> None:
        for pack in self.context_map["contextPacks"]:
            self.assertLessEqual(len(pack["readFirstPaths"]), 2, pack["id"])
            for relpath in pack["readFirstPaths"]:
                self.assertIn(relpath, self.context_map["sourceHashes"], relpath)
            for field in ("readFirstPaths", "secondaryPaths"):
                for relpath in pack[field]:
                    with self.subTest(pack=pack["id"], field=field, relpath=relpath):
                        self.assertFalse(relpath.startswith(("/", "~", "reports/", "tmp/")))
                        self.assertNotIn("\\", relpath)
                        self.assertTrue((ROOT / relpath).exists(), relpath)

    def test_context_paths_cannot_escape_repo(self) -> None:
        for relpath in ("../outside", "docs/../AGENTS.md", "/tmp/outside", "~/outside"):
            with self.subTest(relpath=relpath), self.assertRaises(ValueError):
                builder._require_relpath(relpath)

    def test_generated_doc_does_not_union_leaf_first_reads(self) -> None:
        self.assertNotIn("## Route Read Guidance", CONTEXT_DOC_PATH.read_text(encoding="utf-8"))

    def test_context_pack_selection_is_capped_and_starts_with_preflight(self) -> None:
        prompt = "Use Google Earth imagery, Expo SQLite, center pivot UI, and managed hook registry."
        pack_ids = self.pack_ids_for_prompt(prompt)
        self.assertLessEqual(len(pack_ids), self.context_map["limits"]["maxContextPacksPerHook"])
        self.assertEqual(pack_ids[0], "workspace_preflight")

    def test_governance_prompt_selects_governance_pack(self) -> None:
        context = self.hook_context("Improve token efficient subagent reasoning, prompt triage, and context map hooks.")
        self.assertIn("Context packs", context)
        self.assertIn("governance_hooks_skills", context)
        self.assertIn("docs/agent-tree-protocol.md", context)
        self.assertNotIn("cornergpsmap_bpf", context)

    def test_bpf_prompt_selects_cornergpsmap_pack(self) -> None:
        context = self.hook_context("Analyze CornerGPSMap BPF GGS VRI corner arm map ingestion.")
        self.assertIn("cornergpsmap_bpf", context)
        self.assertIn("packages/core/src/cornerGpsMapImport.ts", context)

    def test_ui_and_database_prompts_select_focused_packs(self) -> None:
        ui_context = self.hook_context("Improve the Expo React Native HUD map workspace screen.")
        self.assertIn("interface_ui", ui_context)
        self.assertNotIn("storage_archive_native", ui_context)

        right_sidebar_context = self.hook_context("Refactor right-drawer toolbar UI-proof controls.")
        self.assertIn("interface_ui", right_sidebar_context)
        self.assertIn(".agents/skills/cplayout-interface-development-agent/SKILL.md", right_sidebar_context)

        db_context = self.hook_context("Review SQLite project archive ZIP schema migration.")
        self.assertIn("storage_archive_native", db_context)
        self.assertNotIn("interface_ui", db_context)

    def test_map_visual_elements_prompt_selects_interface_and_geometry_packs(self) -> None:
        pack_ids = self.pack_ids_for_prompt("Improve map visual elements for wheel tracks and end-of-machine indicators.")
        self.assertIn("interface_ui", pack_ids)
        self.assertIn("geometry_design", pack_ids)

    def test_runtime_gis_and_qa_prompts_select_focused_packs(self) -> None:
        runtime_context = self.hook_context("Review native proof release gate and Android verification.")
        self.assertIn("runtime_proof_gates", runtime_context)
        self.assertIn(".agents/skills/cplayout-runtime-proof-gate-agent/SKILL.md", runtime_context)

        gis_context = self.hook_context("Preserve projected XY CRS boundary WGS84 display and map package attribution.")
        self.assertIn("gis_geometry_guardrails", gis_context)
        self.assertIn(".agents/skills/cplayout-gis-geometry-guard-agent/SKILL.md", gis_context)
        self.assertNotIn("imagery_kml_evidence", gis_context)

        qa_context = self.hook_context("Review validation triage acceptance gate test gap and audit finding.")
        self.assertIn("qa_validation_evidence", qa_context)
        self.assertIn(".agents/skills/cplayout-qa-validation-agent/SKILL.md", qa_context)

    def test_lrdu_sdu_safety_zone_prompt_selects_geometry_pack(self) -> None:
        pack_ids = self.pack_ids_for_prompt("Review LRDU SDU safety zone tire RPM corner arm extension and retraction evidence.")
        self.assertIn("geometry_design", pack_ids)

    def test_invalid_context_map_degrades_gracefully(self) -> None:
        context = self.hook_context(
            "Improve token efficient subagent reasoning and prompt triage.",
            {"schemaVersion": 1},
        )
        self.assertIn("CPLayout advisory routes:", context)
        self.assertNotIn("Context packs", context)
        self.assertIn("Read first: AGENTS.md.", context)

    def test_subagent_start_includes_agent_context_packs(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SUBAGENT_START_PATH)],
            cwd=ROOT,
            input=json.dumps({"hook_event_name": "SubagentStart", "agent_type": "cplayout_kb_curator"}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Context packs:", context)
        self.assertIn("governance_hooks_skills", context)
        self.assertIn("preserve other work and keep assigned scopes separate", context)
        self.assertLessEqual(len(context.encode("utf-8")), 900)


if __name__ == "__main__":
    unittest.main()
