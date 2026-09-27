from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
HOOK_PATH = ROOT / ".codex" / "hooks" / "cplayout_prompt_triage.py"
STOP_HOOK_PATH = ROOT / ".codex" / "hooks" / "cplayout_stop_multi_agent.py"
SUBAGENT_HOOK_PATH = ROOT / ".codex" / "hooks" / "cplayout_subagent_start.py"
CONTEXT_MAP_PATH = ROOT / ".codex" / "hooks" / "cplayout_context_map.json"

spec = importlib.util.spec_from_file_location("cplayout_prompt_triage", HOOK_PATH)
assert spec is not None and spec.loader is not None
triage = importlib.util.module_from_spec(spec)
sys.modules["cplayout_prompt_triage"] = triage
spec.loader.exec_module(triage)

stop_spec = importlib.util.spec_from_file_location("cplayout_stop_multi_agent", STOP_HOOK_PATH)
assert stop_spec is not None and stop_spec.loader is not None
stop_hook = importlib.util.module_from_spec(stop_spec)
sys.modules["cplayout_stop_multi_agent"] = stop_hook
stop_spec.loader.exec_module(stop_hook)


class PromptTriageTests(unittest.TestCase):
    def test_delegation_restrictions_override_matching_topics(self) -> None:
        for prompt in (
            "Do not delegate. Review SQLite schema migration.",
            "Do not use subagents. Fix a typo in the Expo UI screen.",
            "No subagents; review projected XY CRS transforms.",
            "Coordinator-only review of prompt triage and context maps.",
        ):
            with self.subTest(prompt=prompt):
                matches = triage.match_routes(prompt)
                self.assertTrue(matches)
                self.assertFalse(triage.has_explicit_multi_agent_request(prompt))
                self.assertEqual(triage.subagent_decision(prompt, matches)[0], "not useful")

    def route_ids(self, prompt: str) -> list[str]:
        return [match.route.route_id for match in triage.match_routes(prompt)]

    def hook_context(self, prompt: str) -> str:
        return triage._context(prompt, triage.match_routes(prompt), False)  # noqa: SLF001 - hook contract test.

    def test_strong_imagery_prompt_selects_imagery_route(self) -> None:
        routes = self.route_ids("Use Google Earth Pro KML imagery to prove visual fidelity.")
        self.assertEqual(routes[0], "cplayout_imagery_mapper")

    def test_sqlite_archive_prompt_selects_database_route(self) -> None:
        routes = self.route_ids("Review Expo SQLite project archive persistence and ZIP schema migration.")
        self.assertEqual(routes[0], "cplayout_database_specialist")

    def test_runtime_proof_prompt_selects_gatekeeper_route(self) -> None:
        routes = self.route_ids("Review Android verification native proof release gate and production-ready claim.")
        self.assertEqual(routes[0], "cplayout_runtime_proof_gatekeeper")

    def test_gis_crs_prompt_selects_geometry_guardian_route(self) -> None:
        routes = self.route_ids("Preserve projected XY CRS boundary WGS84 display coordinate transform and geometry mutation.")
        self.assertEqual(routes[0], "cplayout_gis_geometry_guardian")
        self.assertNotIn("cplayout_imagery_mapper", routes)

    def test_qa_validation_prompt_selects_validation_reviewer_route(self) -> None:
        routes = self.route_ids("Perform validation triage for acceptance gate test gap audit finding and release evidence.")
        self.assertEqual(routes[0], "cplayout_qa_validation_reviewer")

    def test_ui_expo_prompt_selects_interface_route(self) -> None:
        routes = self.route_ids("Improve the Expo React Native UI screen and SVG map component.")
        self.assertEqual(routes[0], "cplayout_interface_developer")

    def test_rtk_hardware_prompt_routes_runtime_interface_and_gis(self) -> None:
        prompt = (
            "Implement Android USB GNSS and Web Serial for an RTK receiver with source CRS confirmation, "
            "then validate a GNSS field report and RTK field proof."
        )
        routes = self.route_ids(prompt)
        self.assertEqual(routes[0], "cplayout_runtime_proof_gatekeeper")
        self.assertIn("cplayout_interface_developer", routes)
        self.assertIn("cplayout_gis_geometry_guardian", routes)
        self.assertIn("cplayout_runtime_proof_gatekeeper", self.hook_context(prompt))

    def test_right_sidebar_toolbar_ui_proof_prompt_selects_interface_route(self) -> None:
        routes = self.route_ids("Refactor right-sidebar and right-drawer toolbar UI-proof controls.")
        self.assertEqual(routes[0], "cplayout_interface_developer")

    def test_map_visual_elements_prompt_routes_interface_and_pivot(self) -> None:
        routes = self.route_ids("Improve map visual elements for wheel tracks and end-of-machine indicators.")
        self.assertIn("cplayout_interface_developer", routes)
        self.assertIn("cplayout_center_pivot_designer", routes)

    def test_process_record_route_terms_select_curator_route(self) -> None:
        routes = self.route_ids("Update context-map route data and validate_cplayout_skills process records.")
        self.assertEqual(routes[0], "cplayout_kb_curator")

    def test_governance_keyword_updates_route_curator(self) -> None:
        routes = self.route_ids("Update governance keywords and route keyword tests.")
        self.assertEqual(routes[0], "cplayout_kb_curator")

    def test_pivot_corner_arm_prompt_selects_pivot_route(self) -> None:
        routes = self.route_ids("Score a center pivot corner arm irrigation layout around obstacles.")
        self.assertEqual(routes[0], "cplayout_center_pivot_designer")

    def test_lrdu_sdu_safety_zone_tire_rpm_prompt_selects_pivot_route(self) -> None:
        routes = self.route_ids("Review LRDU SDU safety-zone drive unit tire and motor RPM advisory inputs.")
        self.assertEqual(routes[0], "cplayout_center_pivot_designer")

    def test_corner_angle_extension_retraction_phrases_select_pivot_route(self) -> None:
        routes = self.route_ids("Review corner angle, steer angle, corner arm extension, and corner arm retraction evidence.")
        self.assertEqual(routes[0], "cplayout_center_pivot_designer")

    def test_broad_terms_do_not_overmatch(self) -> None:
        for prompt in (
            "agent",
            "hook",
            "layout",
            "web",
            "help",
            "angle",
            "extension",
            "retraction",
            "tire",
            "rpm",
            "runtime",
            "proof",
            "gate",
            "geometry",
            "gis",
            "qa",
            "validation",
            "reviewer",
            "test",
            "check",
            "gps",
            "serial",
            "receiver",
        ):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.route_ids(prompt), [])

    def test_token_matching_does_not_match_inside_words(self) -> None:
        self.assertEqual(self.route_ids("Review imageboard management storagebags with no CPLayout task."), [])

    def test_phrase_matching_handles_punctuation(self) -> None:
        routes = self.route_ids("Capture Google-Earth KMZ render proof with non-black evidence.")
        self.assertEqual(routes[0], "cplayout_imagery_mapper")

    def test_mixed_prompt_is_capped_and_deterministic(self) -> None:
        routes = self.route_ids(
            "Use Google Earth imagery, Expo SQLite, center pivot UI, and managed hook registry."
        )
        self.assertLessEqual(len(routes), 3)
        self.assertEqual(
            routes,
            [
                "cplayout_database_specialist",
                "cplayout_kb_curator",
                "cplayout_imagery_mapper",
            ],
        )

    def test_mixed_new_specialist_prompt_is_capped(self) -> None:
        routes = self.route_ids(
            "Review Android verification native proof, projected XY CRS boundary, validation triage, "
            "acceptance gate, Google Earth imagery, SQLite ZIP proof, and managed hook registry."
        )
        self.assertLessEqual(len(routes), 3)
        self.assertEqual(routes[0], "cplayout_runtime_proof_gatekeeper")
        self.assertIn("cplayout_gis_geometry_guardian", routes)
        self.assertIn("cplayout_qa_validation_reviewer", routes)

    def test_runtime_proof_prefers_gatekeeper_over_database_without_storage_request(self) -> None:
        routes = self.route_ids("Native proof release gate for Android verification and MapLibre proof.")
        self.assertEqual(routes[0], "cplayout_runtime_proof_gatekeeper")
        self.assertNotIn("cplayout_database_specialist", routes)

    def test_storage_specific_runtime_prompt_can_include_database(self) -> None:
        routes = self.route_ids("SQLite ZIP proof for project archive persistence schema migration.")
        self.assertEqual(routes[0], "cplayout_database_specialist")
        self.assertIn("cplayout_runtime_proof_gatekeeper", routes)

    def test_negative_keywords_reduce_false_positives(self) -> None:
        routes = self.route_ids("Do database only work on SQLite schema; no imagery and no pivot design.")
        self.assertEqual(routes, ["cplayout_database_specialist"])

    def test_google_earth_inspired_help_prompt_routes_specialists(self) -> None:
        routes = self.route_ids(
            "Implement Google Earth-inspired companion evidence map imagery organization onboarding help prompts."
        )
        self.assertEqual(
            routes,
            [
                "cplayout_imagery_mapper",
                "cplayout_kb_curator",
                "cplayout_interface_developer",
            ],
        )

    def test_hud_will_rhea_prompt_routes_interface_and_imagery(self) -> None:
        routes = self.route_ids("HUD-first map workspace and Will Rhea advisory demo.")
        self.assertEqual(routes[:2], ["cplayout_interface_developer", "cplayout_imagery_mapper"])

    def test_token_efficient_subagent_reasoning_prompt_routes_curator(self) -> None:
        routes = self.route_ids("Token efficient subagent reasoning with advisory hooks and xhigh coordinator route band.")
        self.assertEqual(routes[0], "cplayout_kb_curator")

    def test_governance_prompt_emits_only_two_read_refs(self) -> None:
        context_map = {
            "sourceHashes": {
                path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                for path in ("AGENTS.md", ".codex/hooks/cplayout_prompt_triage.py")
            },
            "contextPacks": [
                {"id": "workspace_preflight", "readFirstPaths": ["AGENTS.md", "docs/agent-tree-protocol.md"]},
                {"id": "governance_hooks_skills", "readFirstPaths": [".codex/hooks/cplayout_prompt_triage.py", "docs/README.md"]},
            ],
            "routeContext": {"cplayout_kb_curator": ["workspace_preflight", "governance_hooks_skills"]},
        }
        prompt = "Use prompt triage, route data, and governance keywords."
        context = triage._context(prompt, triage.match_routes(prompt), False, context_map)
        self.assertIn("Context packs: workspace_preflight, governance_hooks_skills.", context)
        self.assertIn("Read first: AGENTS.md; .codex/hooks/cplayout_prompt_triage.py.", context)
        self.assertNotIn("docs/README.md", context)
        self.assertLessEqual(len(context.encode("utf-8")), 1200)

    def test_route_metadata_is_loaded(self) -> None:
        route_data = triage.load_route_data()
        curator = next(route for route in route_data.routes if route.route_id == "cplayout_kb_curator")
        self.assertEqual(route_data.unmatched_complexity, "complexity analysis required before mutation")
        self.assertEqual(route_data.unmatched_reasoning_effort, "select reasoning effort after task complexity analysis")
        self.assertEqual(curator.agent, "cplayout_kb_curator")
        self.assertEqual(curator.complexity_band, "xhigh")
        self.assertEqual(curator.reasoning_effort, "xhigh")
        self.assertEqual(curator.subagent_reasoning_effort, "task_selected")
        self.assertEqual(curator.spawn_policy, "required")
        self.assertTrue(curator.routing_reason)
        self.assertTrue(curator.validation_expectations)

    def test_advisory_context_is_route_first_without_reprompt(self) -> None:
        context = self.hook_context("Use multi-agent expert panels to review managed hook enforcement with prompt triage.")
        self.assertTrue(context.startswith("CPLayout advisory routes: cplayout_kb_curator."))
        self.assertIn("Route bands: xhigh/xhigh; confirm from task scope.", context)
        self.assertIn("Subagent decision: required", context)
        self.assertNotIn("Optimized re-prompt", context)
        self.assertIn("Hooks are advisory, not enforcement.", context)

    def test_explicit_multi_agent_without_route_still_requires_decision(self) -> None:
        prompt = "Please use parallel agents for a typography review."
        self.assertEqual(self.route_ids(prompt), [])
        self.assertIn("Subagent decision: required", self.hook_context(prompt))

    def test_quoted_no_delegation_does_not_override_request(self) -> None:
        prompt = 'Use multi-agent expert panels; the example string says "do not delegate".'
        self.assertFalse(triage.has_delegation_restriction(prompt))
        self.assertIn("Subagent decision: required", self.hook_context(prompt))

    def test_subagent_topic_word_is_not_delegation_request(self) -> None:
        prompt = "Improve token efficient subagent reasoning, prompt triage, and context map hooks."
        self.assertFalse(triage.has_explicit_multi_agent_request(prompt))
        self.assertIn("Subagent decision: optional", self.hook_context(prompt))

    def test_matched_specialist_route_does_not_automatically_require_subagent(self) -> None:
        context = self.hook_context("Review Expo SQLite project archive persistence and ZIP schema migration.")
        self.assertIn("Subagent decision: optional", context)
        self.assertIn("cplayout_database_specialist", context)

    def test_malformed_payload_still_returns_shape_warning(self) -> None:
        result = subprocess.run(
            [sys.executable, str(HOOK_PATH)],
            input="Use managed hook enforcement.",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "UserPromptSubmit")
        self.assertIn("Hook input shape was incomplete or non-JSON", output["additionalContext"])

    def test_no_match_prompt_gets_coordinator_only_advisory(self) -> None:
        context = self.hook_context("Format this sentence with no CPLayout domain change.")
        self.assertIn("CPLayout advisory routes: none.", context)
        self.assertIn("Subagent decision: not useful", context)
        self.assertNotIn("Route bands:", context)

    def test_twelve_prompt_route_oracle_and_context_budget(self) -> None:
        cases = (
            ("Implement Google Earth Pro KML imagery visual fidelity proof.", ["cplayout_imagery_mapper"]),
            ("Review Expo SQLite project archive persistence and ZIP schema migration.", ["cplayout_database_specialist", "cplayout_interface_developer"]),
            ("Review Android verification native proof release gate and production-ready claim.", ["cplayout_runtime_proof_gatekeeper"]),
            ("Preserve projected XY CRS boundary WGS84 display coordinate transform.", ["cplayout_gis_geometry_guardian"]),
            ("Improve Expo React Native HUD map workspace screen.", ["cplayout_interface_developer"]),
            ("Improve map visual elements for wheel tracks, end-of-machine indicators, and bottom HUD.", ["cplayout_interface_developer", "cplayout_center_pivot_designer"]),
            ("Score center pivot corner arm irrigation layout around obstacles.", ["cplayout_center_pivot_designer"]),
            ("Use multi-agent expert panels to review Expo SQLite project archive persistence, Google Earth imagery, and Android verification native proof release gate.", ["cplayout_database_specialist", "cplayout_runtime_proof_gatekeeper", "cplayout_imagery_mapper"]),
            ("Format this sentence.", []),
            ("What is the time?", []),
            ("Explain why this sentence reads oddly.", []),
            ('The log says "do not delegate"; review the wording.', []),
        )
        context_map = json.loads(CONTEXT_MAP_PATH.read_text(encoding="utf-8"))
        total_bytes = 0
        total_refs = 0
        matched = 0
        for prompt, expected in cases:
            with self.subTest(prompt=prompt):
                matches = triage.match_routes(prompt)
                self.assertEqual([match.route.route_id for match in matches], expected)
                matched += bool(matches)
                context = triage._context(prompt, matches, False, context_map)
                encoded_bytes = len(context.encode("utf-8"))
                self.assertLessEqual(encoded_bytes, 1200)
                self.assertNotIn("Optimized re-prompt", context)
                self.assertLessEqual(len(expected), 3)
                read_line = next(line for line in context.splitlines() if line.startswith("Read first: "))
                refs = read_line.removeprefix("Read first: ").removesuffix(".").split("; ")
                self.assertLessEqual(len(refs), 2)
                self.assertEqual(refs[0], "AGENTS.md")
                total_bytes += encoded_bytes
                total_refs += len(refs)
        self.assertEqual(matched, 8)
        self.assertLess(total_bytes, 8000)
        self.assertLessEqual(total_refs, 24)

    def test_context_map_hash_mismatch_discards_map_refs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            hashes = {}
            for relative in triage.AUTHORITY_PATHS:
                source = root / relative
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text("current instructions", encoding="utf-8")
                hashes[relative] = hashlib.sha256(source.read_bytes()).hexdigest()
            hook_dir = root / ".codex" / "hooks"
            hook_dir.mkdir(parents=True, exist_ok=True)
            context_map_path = hook_dir / "cplayout_context_map.json"
            context_map = {
                "schemaVersion": 1,
                "contextPacks": [],
                "routeContext": {},
                "sourceHashes": hashes,
            }
            context_map_path.write_text(json.dumps(context_map), encoding="utf-8")
            self.assertIsNotNone(triage.load_context_map(context_map_path))
            for relative in ("AGENTS.md", "docs/agent-tree-protocol.md", ".codex/config.toml", ".codex/hooks/cplayout_route_data.json"):
                with self.subTest(relative=relative):
                    source = root / relative
                    source.write_text("changed instructions", encoding="utf-8")
                    self.assertIsNone(triage.load_context_map(context_map_path))
                    source.write_text("current instructions", encoding="utf-8")
            context_map.pop("sourceHashes")
            context_map_path.write_text(json.dumps(context_map), encoding="utf-8")
            self.assertIsNone(triage.load_context_map(context_map_path))

    def test_subagent_context_budget_and_unknown_profile_scope(self) -> None:
        for agent_type in ("cplayout_database_specialist", "worker"):
            with self.subTest(agent_type=agent_type):
                result = subprocess.run(
                    [sys.executable, str(SUBAGENT_HOOK_PATH)],
                    input=json.dumps({"hook_event_name": "SubagentStart", "agent_type": agent_type}),
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
                output = json.loads(result.stdout)["hookSpecificOutput"]
                self.assertEqual(output["hookEventName"], "SubagentStart")
                context = output["additionalContext"]
                self.assertLessEqual(len(context.encode("utf-8")), 900)
                self.assertIn("Read first: AGENTS.md", context)
                self.assertIn("Hooks are advisory", context)
                if agent_type == "worker":
                    self.assertIn("coordinator-assigned scope", context)
                    self.assertNotIn("stay read-only", context)

    def stop_hook_output(self, payload: dict[str, object]) -> str:
        result = subprocess.run(
            [sys.executable, str(STOP_HOOK_PATH)],
            input=json.dumps(payload),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return result.stdout

    def test_stop_hook_is_disabled_for_explicit_multi_agent_without_decision(self) -> None:
        output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "prompt": "Use multi-agent expert panels to review managed hook enforcement.",
                "last_assistant_message": "Implemented the change and ran tests.",
            }
        )
        self.assertEqual(output.strip(), "")

    def test_stop_hook_is_disabled_for_matched_specialist_without_decision(self) -> None:
        output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "prompt": "Review Expo SQLite project archive persistence and ZIP schema migration.",
                "last_assistant_message": "Validated the storage route.",
            }
        )
        self.assertEqual(output.strip(), "")

    def test_stop_hook_disabled_state_is_silent_with_official_payload_and_loop_guard(self) -> None:
        output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "prompt": "Review Expo SQLite project archive persistence and ZIP schema migration.",
                "last_assistant_message": "Validated the storage route.",
            }
        )
        self.assertEqual(output.strip(), "")

        guarded_output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": True,
                "prompt": "Review Expo SQLite project archive persistence and ZIP schema migration.",
                "last_assistant_message": "Validated the storage route.",
            }
        )
        self.assertEqual(guarded_output.strip(), "")

    def test_stop_hook_ignores_stale_transcript_route_when_latest_prompt_does_not_match(self) -> None:
        output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "messages": [
                    {"role": "user", "content": "Use multi-agent expert panels for managed hook enforcement."},
                    {"role": "assistant", "content": "Implemented the process change."},
                    {"role": "user", "content": "what is causing repeated stream interruptions?"},
                    {"role": "assistant", "content": "Those were client interrupt events, not stream failures."},
                ],
            }
        )
        self.assertEqual(output.strip(), "")

    def test_stop_hook_stays_silent_when_latest_role_message_requires_accounting(self) -> None:
        output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "messages": [
                    {"role": "user", "content": "Format this sentence."},
                    {"role": "assistant", "content": "Done."},
                    {
                        "role": "user",
                        "content": "Review Expo SQLite project archive persistence and ZIP schema migration.",
                    },
                    {"role": "assistant", "content": "Validated the storage route."},
                ],
            }
        )
        self.assertEqual(output.strip(), "")

    def test_stop_hook_fails_open_for_unstructured_transcript_or_missing_final(self) -> None:
        unstructured_output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "transcript": "Old request: use multi-agent panels. Latest answer: done.",
                "last_assistant_message": "Done.",
            }
        )
        self.assertEqual(unstructured_output.strip(), "")

        missing_final_output = self.stop_hook_output(
            {
                "hook_event_name": "Stop",
                "stop_hook_active": False,
                "prompt": "Use multi-agent expert panels to review managed hook enforcement.",
            }
        )
        self.assertEqual(missing_final_output.strip(), "")

    def test_stop_hook_accepts_exact_subagent_decision_or_fallback_labels(self) -> None:
        for assistant_response in (
            "Subagent decision: required. Spawned the database specialist and summarized findings.",
            "Accepted fallback: no subagent tool is available, so review was local.",
        ):
            with self.subTest(assistant_response=assistant_response):
                output = self.stop_hook_output(
                    {
                        "hook_event_name": "Stop",
                        "prompt": "Review Expo SQLite project archive persistence and ZIP schema migration.",
                        "last_assistant_message": assistant_response,
                    }
                )
                self.assertEqual(output.strip(), "")


if __name__ == "__main__":
    unittest.main()
