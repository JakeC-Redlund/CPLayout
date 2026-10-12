from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch


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

subagent_spec = importlib.util.spec_from_file_location("context_tests_subagent", SUBAGENT_START_PATH)
assert subagent_spec and subagent_spec.loader
subagent = importlib.util.module_from_spec(subagent_spec)
subagent_spec.loader.exec_module(subagent)


class ContextMapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.context_map = builder._build_context_map()

    def pack_ids_for_prompt(self, prompt: str) -> list[str]:
        matches = triage.match_routes(prompt)
        return [
            pack["id"]
            for pack in triage.context_packs_for_matches(prompt, matches, self.context_map)
            if isinstance(pack.get("id"), str)
        ]

    def hook_context(self, prompt: str, context_map: dict[str, object] | None = None) -> str:
        return triage._context(prompt, triage.match_routes(prompt), False, self.context_map if context_map is None else context_map)  # noqa: SLF001

    def test_every_role_index_stays_inside_hook_pack_budget(self) -> None:
        budget = self.context_map["limits"]["maxContextPacksPerHook"]
        for field in ("routeContext", "agentContext"):
            for role, refs in self.context_map[field].items():
                with self.subTest(field=field, role=role):
                    self.assertLessEqual(len(refs), budget)

    def test_unified_preservation_is_primary_with_role_contract_and_proof_refs(self) -> None:
        roles = {
            "cplayout_interface_developer": "interface_ui",
            "cplayout_database_specialist": "storage_archive_native",
            "cplayout_gis_geometry_guardian": "gis_geometry_guardrails",
        }
        for field in ("routeContext", "agentContext"):
            for role, contract in roles.items():
                with self.subTest(field=field, role=role):
                    self.assertEqual(self.context_map[field][role], ["workspace_preflight", "unified_mode_preservation", contract])
        packs = {pack["id"]: pack for pack in self.context_map["contextPacks"]}
        self.assertEqual(packs["unified_mode_preservation"]["readFirstPaths"], ["docs/production-workflow-improvement-plan.md", "docs/operator-workflow-guide.md"])
        self.assertIn("apps/api/src/server.ts", packs["unified_mode_preservation"]["secondaryPaths"])
        self.assertIn("packages/core/src/surveyDraftField.ts", packs["unified_mode_preservation"]["secondaryPaths"])
        for contract in ("interface_ui", "gis_geometry_guardrails"):
            self.assertIn("docs/rtk-gnss-integration-plan.md", packs[contract]["secondaryPaths"])
        self.assertIn("packages/core/src/projectDocument.ts", packs["storage_archive_native"]["secondaryPaths"])
        self.assertIn("runtime_proof_gates", self.context_map["routeContext"]["cplayout_runtime_proof_gatekeeper"])
        self.assertIn("rtk_gnss_hardware", self.context_map["routeContext"]["cplayout_runtime_proof_gatekeeper"])

    def test_generator_rejects_over_budget_role_indices(self) -> None:
        import copy
        for field in ("routeContext", "agentContext"):
            mutated = copy.deepcopy(self.context_map)
            mutated[field]["cplayout_interface_developer"].append("rtk_gnss_hardware")
            with self.subTest(field=field), self.assertRaises(ValueError):
                builder._validate_context_map(mutated)

    def test_production_workflow_routes_current_sources_without_receipt_hash_cycle(self) -> None:
        matches = triage.match_routes("CPLayout sign in authenticated workspace customer project workflow SurveyKnownInformation production workflow acceptance")
        routes = {match.route.route_id for match in matches}
        self.assertTrue({"cplayout_interface_developer", "cplayout_database_specialist", "cplayout_qa_validation_reviewer"}.issubset(routes))
        for prompt in ["CPLayout sign in authenticated workspace", "SurveyKnownInformation optional Design survey preparation"]:
            self.assertIn("unified_mode_preservation", self.pack_ids_for_prompt(prompt))
        for path in ["apps/api/src/server.ts", "packages/auth-client/src/apiClient.ts", "apps/mobile/src/auth/authenticatedRepository.ts", "apps/mobile/src/workspace/SurveyKnownInformationPanel.tsx"]:
            self.assertIn(path, self.context_map["sourceHashes"])
        for authority in ["docs/workflow-registry.json", "docs/development-status.md"]:
            self.assertNotIn(authority, self.context_map["sourceHashes"])
            self.assertFalse(any(authority in pack["readFirstPaths"] for pack in self.context_map["contextPacks"]))
        self.assertTrue(any(ref["path"] == "docs/workflow-registry.json" and ref["kind"] == "live-authority-pointer" for ref in self.context_map["globalContext"]))
        with patch.object(builder, "SOURCE_HASH_PATHS", builder.SOURCE_HASH_PATHS + ["docs/workflow-registry.json"]), self.assertRaisesRegex(ValueError, "remain pointers"):
            builder._source_hashes()

    def test_unified_modes_select_preservation_contract(self) -> None:
        prompt = "Unify Design Survey Layout in one workspace; preserve dirty input and receiver ownership during mode switches."
        context = self.hook_context(prompt, self.context_map)
        self.assertIn("unified_mode_preservation", context)
        self.assertIn("docs/production-workflow-improvement-plan.md", context)
        self.assertNotIn("Read first: AGENTS.md", context)
        self.assertLessEqual(len(context.encode("utf-8")), 1200)

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
                "unified_mode_preservation",
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
        self.assertIn("Read first: docs/agent-tree-protocol.md.", context)

    def test_subagent_start_includes_agent_context_packs(self) -> None:
        with patch.object(subagent, "_load_context_map", return_value=self.context_map):
            context = subagent._context({"agent_type": "cplayout_kb_curator"})
        self.assertIn("Context packs:", context)
        self.assertIn("governance_hooks_skills", context)
        self.assertIn("preserve other work and keep assigned scopes separate", context)
        self.assertLessEqual(len(context.encode("utf-8")), 900)


if __name__ == "__main__":
    unittest.main()
