#!/usr/bin/env python3
"""Build the CPLayout agent context map.

The generated map is intentionally compact. It gives hooks and coordinators
route-specific file references, not raw source or report excerpts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import tomllib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTEXT_MAP_PATH = ROOT / ".codex" / "hooks" / "cplayout_context_map.json"
CONTEXT_DOC_PATH = ROOT / "docs" / "agent-context-map.md"
GOVERNANCE_SUMMARY_PATH = ROOT / "docs" / "agent-governance-summary.md"
ROUTE_DATA_PATH = ROOT / ".codex" / "hooks" / "cplayout_route_data.json"

LIMITS = {
    "maxContextPacksPerHook": 3,
    "maxReadFirstPathsPerPack": 5,
    "maxSecondaryPathsPerPack": 5,
    "maxValidationCommandsPerPack": 5,
    "maxEmittedPackSummaryChars": 1200,
    "maxContextPackTokenBudget": 1200,
    "maxGovernanceSummaryChars": 7000,
}

VALIDATION_COMMANDS = {
    "validate_skills": {
        "command": "npm run validate:skills",
        "purpose": "Validate repo-local skills, hooks, route data, context map, custom agents, and process docs.",
    },
    "context_map_check": {
        "command": "npm run context-map:check",
        "purpose": "Verify generated context-map JSON and Markdown are fresh.",
    },
    "validate_design_guides": {
        "command": "npm run validate:design-guides",
        "purpose": "Validate curated local design-guide summaries when those records change.",
    },
    "validate_corner_service_manuals": {
        "command": "npm run validate:corner-service-manuals",
        "purpose": "Validate curated corner-service manual summaries when those records change.",
    },
    "validate_product": {
        "command": "npm run validate",
        "purpose": "Run TypeScript and workspace tests after TypeScript or product app changes.",
    },
    "proof_web": {
        "command": "npm run proof:web",
        "purpose": "Run browser export and Playwright checks after visible web UI changes.",
    },
    "diff_check": {
        "command": "git diff --check",
        "purpose": "Catch whitespace errors before committing.",
    },
    "audit": {
        "command": "npm audit",
        "purpose": "Report npm dependency advisories without applying force fixes.",
    },
}

HARD_VETOES = [
    {
        "id": "no_paid_or_keyed_services",
        "summary": "Do not add paid map APIs, paid imagery, paid cloud backends, trial-only SDKs, or hidden keys.",
    },
    {
        "id": "no_runtime_proof_without_evidence",
        "summary": "Do not claim native, SQLite, ZIP, MapLibre, Google Earth, imagery, or ML/CV proof without direct checklist evidence.",
    },
    {
        "id": "preserve_projected_xy",
        "summary": "Canonical project geometry remains projected/local XY; WGS84 and KML/KMZ styling are input/display or visual metadata.",
    },
    {
        "id": "hooks_are_advisory",
        "summary": "Repo-local hooks add advisory context only; managed enforcement requires managed deployment plus restart verification.",
    },
    {
        "id": "stop_hook_disabled",
        "summary": "Do not re-enable Stop continuation behavior without a separate payload audit and loop-proof tests.",
    },
]

GLOBAL_CONTEXT = [
    {
        "id": "agents_root",
        "path": "AGENTS.md",
        "kind": "instructions",
        "summary": "Durable CPLayout repository rules, preflight, reasoning policy, and validation gates.",
        "tags": ["preflight", "governance", "constraints"],
    },
    {
        "id": "prompt_registry",
        "path": "docs/agent-prompt-registry.md",
        "kind": "record",
        "summary": "Human-readable specialist routing, persistent subagent authorization, and hook surface registry.",
        "tags": ["routing", "records", "subagents"],
    },
    {
        "id": "governance_summary",
        "path": "docs/agent-governance-summary.md",
        "kind": "generated-entrypoint",
        "summary": "Concise generated first-read for active governance contracts, caveats, validation, and detailed-ledger links.",
        "tags": ["governance", "token-efficiency", "generated"],
    },
    {
        "id": "known_gaps",
        "path": "docs/agent-known-gaps.md",
        "kind": "record",
        "summary": "Current process and proof gaps; prevents advisory context from becoming runtime claims.",
        "tags": ["gaps", "proof", "records"],
    },
]

PACK_DEFINITIONS = [
    {
        "id": "workspace_preflight",
        "purpose": "Load the durable CPLayout work contract and dirty-tree/validation expectations before non-trivial changes.",
        "routeIds": ["*"],
        "agentIds": ["*"],
        "triggerTerms": ["preflight", "git status", "validation", "AGENTS.md"],
        "readFirstPaths": [
            "AGENTS.md",
            "docs/agent-governance-summary.md",
            "package.json",
            "docs/center-pivot-package-surface-inventory.md",
        ],
        "secondaryPaths": [
            ".agents/skills/cplayout-workspace-preflight/SKILL.md",
            "docs/agent-known-gaps.md",
            "docs/dependency-upgrade-plan.md",
        ],
        "validationCommandIds": ["validate_skills", "diff_check", "audit"],
        "expectedOutput": "Complexity band, selected reasoning effort, subagent decision, dirty-tree summary, and validation gates.",
        "tokenBudget": 650,
        "hardVetoIds": ["no_paid_or_keyed_services", "preserve_projected_xy", "hooks_are_advisory"],
    },
    {
        "id": "governance_hooks_skills",
        "purpose": "Review and update prompt triage, route data, hooks, custom agents, skills, and process records.",
        "routeIds": ["cplayout_kb_curator"],
        "agentIds": ["cplayout_kb_curator"],
        "triggerTerms": ["prompt triage", "managed hook", "token efficient", "subagent reasoning", "context map", "context-map", "route data", "validate_cplayout_skills"],
        "readFirstPaths": [
            "docs/agent-governance-summary.md",
            ".codex/hooks/cplayout_prompt_triage.py",
            ".codex/hooks/cplayout_route_data.json",
            "tools/validate_cplayout_skills.py",
            "docs/README.md",
        ],
        "secondaryPaths": [
            ".codex/hooks.json",
            ".codex/hooks/cplayout_subagent_start.py",
            "docs/agent-known-gaps.md",
            "docs/agent-source-ledger.md",
            "docs/codex-managed-hook-deployment.md",
        ],
        "validationCommandIds": ["context_map_check", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Source-backed governance change summary, advisory-hook caveats, record updates, and test evidence.",
        "tokenBudget": 1200,
        "hardVetoIds": ["hooks_are_advisory", "stop_hook_disabled", "no_runtime_proof_without_evidence"],
    },
    {
        "id": "interface_ui",
        "purpose": "Map Expo React Native, browser UI, HUD, right drawer/sidebar, toolbar, component, UI-proof, and visible workflow work to proof gates.",
        "routeIds": ["cplayout_interface_developer"],
        "agentIds": ["cplayout_interface_developer"],
        "triggerTerms": [
            "Expo",
            "React Native",
            "HUD",
            "right drawer",
            "right-drawer",
            "right sidebar",
            "right-sidebar",
            "toolbar",
            "UI-proof",
            "UI proof",
            "map workspace",
            "map visual elements",
            "wheel track overlay",
            "end-of-machine indicator",
            "machine overlay",
            "screen",
            "Playwright",
        ],
        "readFirstPaths": [
            "apps/mobile/App.tsx",
            "apps/mobile/src/components/CommandSurface.tsx",
            "apps/mobile/src/components/DrawingToolPalette.tsx",
            "packages/map-adapters/src/SvgMapSurface.tsx",
            ".agents/skills/cplayout-interface-development-agent/SKILL.md",
        ],
        "secondaryPaths": [
            "packages/map-adapters/src/MapSurface.tsx",
            "playwright.config.ts",
            "docs/android-native-verification.md",
            "docs/agent-known-gaps.md",
        ],
        "validationCommandIds": ["validate_product", "proof_web", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "UI file scope, right sidebar/drawer and toolbar risks, web UI-proof needs, and native proof caveats.",
        "tokenBudget": 900,
        "hardVetoIds": ["no_paid_or_keyed_services", "no_runtime_proof_without_evidence", "preserve_projected_xy"],
    },
    {
        "id": "rtk_gnss_hardware",
        "purpose": "Route RTK/GNSS receiver, NMEA epoch, correction, antenna, native transport, capture provenance, and field-proof work.",
        "routeIds": [
            "cplayout_interface_developer",
            "cplayout_gis_geometry_guardian",
            "cplayout_runtime_proof_gatekeeper",
        ],
        "agentIds": [
            "cplayout_interface_developer",
            "cplayout_gis_geometry_guardian",
            "cplayout_runtime_proof_gatekeeper",
        ],
        "triggerTerms": [
            "RTK receiver",
            "GNSS hardware",
            "Web Serial",
            "NMEA epoch",
            "NTRIP corrections",
            "RTCM corrections",
            "Android USB GNSS",
            "antenna reference point",
            "coordinate epoch",
            "GNSS field report",
            "RTK field proof",
        ],
        "readFirstPaths": [
            "docs/rtk-gnss-integration-plan.md",
            "packages/gnss/src/nmea.ts",
            "packages/gnss/src/transport.ts",
            "packages/core/src/types.ts",
            "apps/mobile/src/gnss/webSerialTransport.ts",
        ],
        "secondaryPaths": [
            "packages/core/src/projectReducer.ts",
            "apps/mobile/src/components/BrowserRtkReceiverPanel.tsx",
            "docs/android-native-verification.md",
            "docs/agent-known-gaps.md",
            "tools/roadmapCompletion.ts",
        ],
        "validationCommandIds": ["validate_product", "proof_web", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Transport/data-flow scope, CRS authority, receiver/correction/antenna unknowns, hardware proof gates, and explicit non-claims.",
        "tokenBudget": 1100,
        "hardVetoIds": ["no_paid_or_keyed_services", "preserve_projected_xy", "no_runtime_proof_without_evidence"],
    },
    {
        "id": "geometry_design",
        "purpose": "Route center pivot, corner-arm, lateral/linear move, and sprinkler design prompts to advisory geometry evidence.",
        "routeIds": ["cplayout_center_pivot_designer"],
        "agentIds": ["cplayout_center_pivot_designer"],
        "triggerTerms": [
            "center pivot",
            "corner arm",
            "lateral move",
            "linear move",
            "sprinkler",
            "sprinkler package",
            "sprinkler coverage",
            "wheel track",
            "wheel tracks",
            "tower track",
            "tower tracks",
            "end-of-machine",
            "LRDU",
            "SDU",
            "LRDU SDU",
            "safety zone",
            "safety-zone",
            "drive unit tire",
            "tire option",
            "motor RPM",
            "corner angle",
            "steer angle",
            "corner arm extension",
            "corner arm retraction",
            "irrigation",
        ],
        "readFirstPaths": [
            "packages/geometry/src/index.ts",
            "docs/design-guides/topic-index.md",
            ".agents/skills/cplayout-center-pivot-design-agent/SKILL.md",
            "packages/geometry/src/cornerGpsMapAdvisoryReview.ts",
        ],
        "secondaryPaths": [
            "docs/design-guides/guides/local-precision-corner-0999428.md",
            "docs/design-guides/guides/local-vflex-corner-0998325.md",
            "docs/agent-known-gaps.md",
        ],
        "validationCommandIds": ["validate_product", "validate_design_guides", "validate_corner_service_manuals", "diff_check", "audit"],
        "expectedOutput": "Advisory scoring facts, source-backed assumptions, unknown field constraints, and validation implications.",
        "tokenBudget": 950,
        "hardVetoIds": ["preserve_projected_xy", "no_runtime_proof_without_evidence"],
    },
    {
        "id": "core_project_geometry",
        "purpose": "Route project document, KML/XML, sample fixture, and canonical geometry contract work.",
        "routeIds": ["cplayout_database_specialist"],
        "agentIds": [
            "cplayout_database_specialist",
        ],
        "triggerTerms": ["project document", "canonical geometry", "projected XY", "KML", "sample project"],
        "readFirstPaths": [
            "packages/core/src/index.ts",
            "packages/core/src/projectDocument.ts",
            "packages/core/src/projectKml.ts",
            "packages/core/src/sampleProject.ts",
        ],
        "secondaryPaths": [
            "packages/core/src/imageryEvidence.ts",
            "docs/agent-known-gaps.md",
        ],
        "validationCommandIds": ["validate_product", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Projected-XY data-flow summary, schema implications, and evidence-only boundaries.",
        "tokenBudget": 900,
        "hardVetoIds": ["preserve_projected_xy", "no_runtime_proof_without_evidence"],
    },
    {
        "id": "storage_archive_native",
        "purpose": "Route SQLite, project-store, project archive, ZIP, and native/web persistence contract work.",
        "routeIds": ["cplayout_database_specialist"],
        "agentIds": ["cplayout_database_specialist"],
        "triggerTerms": ["SQLite", "project-store", "archive", "ZIP", "migration", "schema"],
        "readFirstPaths": [
            "packages/project-store/src/index.ts",
            "packages/project-store/src/projectArchive.ts",
            "packages/project-store/src/projectRepository.native.ts",
            "packages/core/src/projectDocument.ts",
            ".agents/skills/cplayout-database-agent/SKILL.md",
        ],
        "secondaryPaths": [
            "docs/android-native-verification.md",
            "docs/agent-known-gaps.md",
        ],
        "validationCommandIds": ["validate_product", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Storage contract risks, archive round-trip implications, native proof caveats, and migration tests.",
        "tokenBudget": 900,
        "hardVetoIds": ["no_runtime_proof_without_evidence", "preserve_projected_xy"],
    },
    {
        "id": "runtime_proof_gates",
        "purpose": "Route native proof, Android/iOS verification, Google Earth proof, MapLibre proof, SQLite/ZIP proof, and release claims to evidence gates.",
        "routeIds": ["cplayout_runtime_proof_gatekeeper"],
        "agentIds": ["cplayout_runtime_proof_gatekeeper"],
        "triggerTerms": [
            "runtime proof gate",
            "native proof",
            "release gate",
            "Android verification",
            "iOS verification",
            "MapLibre proof",
            "SQLite ZIP proof",
            "production-ready claim",
        ],
        "readFirstPaths": [
            "AGENTS.md",
            ".agents/skills/cplayout-runtime-proof-gate-agent/SKILL.md",
            "docs/android-native-verification.md",
            "docs/agent-known-gaps.md",
            "docs/agent-source-ledger.md",
        ],
        "secondaryPaths": [
            "docs/android-native-verification-report-template.json",
            "docs/kml-kmz-google-earth-source-ledger.md",
            "packages/project-store/src/nativeVerification.ts",
            "packages/project-store/src/projectRepository.native.ts",
            "docs/native-map-tile-adapter-design.md",
        ],
        "validationCommandIds": ["validate_skills", "validate_product", "diff_check", "audit"],
        "expectedOutput": "Runtime proof blockers, accepted evidence, missing device/visual reports, release non-claims, and record updates.",
        "tokenBudget": 1000,
        "hardVetoIds": [
            "no_runtime_proof_without_evidence",
            "preserve_projected_xy",
            "hooks_are_advisory",
        ],
    },
    {
        "id": "gis_geometry_guardrails",
        "purpose": "Route projected/local XY, CRS, WGS84 input/display, coordinate transforms, geometry mutation, attribution, TileJSON, PMTiles, and MBTiles boundaries.",
        "routeIds": ["cplayout_gis_geometry_guardian"],
        "agentIds": ["cplayout_gis_geometry_guardian"],
        "triggerTerms": [
            "projected XY",
            "canonical geometry",
            "CRS boundary",
            "WGS84 input/display",
            "coordinate transform",
            "geometry mutation",
            "map package attribution",
            "TileJSON",
            "PMTiles",
            "MBTiles",
        ],
        "readFirstPaths": [
            "AGENTS.md",
            ".agents/skills/cplayout-gis-geometry-guard-agent/SKILL.md",
            "packages/core/src/projectDocument.ts",
            "docs/agent-known-gaps.md",
            "docs/imagery-provider-tool-policy-ledger.md",
        ],
        "secondaryPaths": [
            "packages/core/src/imageryEvidence.ts",
            "packages/core/src/projectKml.ts",
            "packages/project-store/src/projectArchive.ts",
            "docs/native-map-tile-adapter-design.md",
            "docs/kml-kmz-google-earth-source-ledger.md",
        ],
        "validationCommandIds": ["validate_product", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Geometry authority risks, CRS/input-display separation, attribution gaps, tile adapter gates, and validation needs.",
        "tokenBudget": 1000,
        "hardVetoIds": ["preserve_projected_xy", "no_paid_or_keyed_services", "no_runtime_proof_without_evidence"],
    },
    {
        "id": "qa_validation_evidence",
        "purpose": "Route validation triage, acceptance gates, test gaps, audit findings, regression evidence, and release evidence to QA review.",
        "routeIds": ["cplayout_qa_validation_reviewer"],
        "agentIds": ["cplayout_qa_validation_reviewer"],
        "triggerTerms": [
            "validation triage",
            "acceptance gate",
            "test gap",
            "proof gate",
            "audit finding",
            "regression evidence",
            "release evidence",
            "Playwright screenshot",
        ],
        "readFirstPaths": [
            "AGENTS.md",
            ".agents/skills/cplayout-qa-validation-agent/SKILL.md",
            "docs/agent-known-gaps.md",
            "docs/agent-governance-summary.md",
            "package.json",
        ],
        "secondaryPaths": [
            "tools/validate_cplayout_skills.py",
            "tools/tests/test_cplayout_prompt_triage.py",
            "tools/tests/test_cplayout_context_map.py",
            "docs/agent-source-ledger.md",
            "docs/android-native-verification.md",
        ],
        "validationCommandIds": ["context_map_check", "validate_skills", "validate_product", "diff_check", "audit"],
        "expectedOutput": "Findings by severity, commands run or missing, stale generated files, audit status, and residual risk.",
        "tokenBudget": 950,
        "hardVetoIds": ["no_runtime_proof_without_evidence", "hooks_are_advisory"],
    },
    {
        "id": "imagery_kml_evidence",
        "purpose": "Route imagery, Google Earth, KML/KMZ, local CV, and evidence packet prompts.",
        "routeIds": ["cplayout_imagery_mapper", "cplayout_kb_curator"],
        "agentIds": ["cplayout_imagery_mapper", "cplayout_kb_curator"],
        "triggerTerms": ["Google Earth", "KML", "KMZ", "imagery", "evidence packet", "computer vision"],
        "readFirstPaths": [
            "docs/kml-kmz-google-earth-source-ledger.md",
            ".agents/skills/cplayout-imagery-mapping-agent/SKILL.md",
            ".agents/skills/cplayout-google-earth-imagery-analysis/SKILL.md",
            "packages/core/src/imageryEvidence.ts",
            "packages/map-adapters/src/MapLibreImageryPreview.tsx",
        ],
        "secondaryPaths": [
            "docs/agent-known-gaps.md",
            "tools/verifyImageryEvidencePacket.ts",
        ],
        "validationCommandIds": ["validate_product", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Evidence category separation, source/attribution risks, visual proof caveats, and validation gates.",
        "tokenBudget": 1000,
        "hardVetoIds": [
            "no_paid_or_keyed_services",
            "no_runtime_proof_without_evidence",
            "preserve_projected_xy",
        ],
    },
    {
        "id": "cornergpsmap_bpf",
        "purpose": "Route CornerGPSMap, BPF, GGS, VRI, and corner-arm map ingestion prompts to verified local evidence.",
        "routeIds": [
            "cplayout_imagery_mapper",
            "cplayout_center_pivot_designer",
        ],
        "agentIds": [
            "cplayout_imagery_mapper",
            "cplayout_center_pivot_designer",
        ],
        "triggerTerms": ["CornerGPSMap", "BPF", "Boundary Point File", "GGS", "VRI", "corner arm map"],
        "readFirstPaths": [
            "packages/core/src/cornerGpsMapImport.ts",
            "packages/core/src/cornerGpsMapImport.test.ts",
            "packages/geometry/src/cornerGpsMapAdvisoryReview.ts",
            "packages/map-adapters/src/mapTools.ts",
            "docs/agent-known-gaps.md",
        ],
        "secondaryPaths": [
            "packages/geometry/src/cornerGpsMapAdvisoryReview.test.ts",
            "packages/map-adapters/src/mapTools.test.ts",
            "docs/agent-prompt-registry.md",
        ],
        "validationCommandIds": ["validate_product", "validate_skills", "diff_check", "audit"],
        "expectedOutput": "Source-labeled BPF evidence review, projected-XY import boundaries, and no controller-compatibility claims.",
        "tokenBudget": 950,
        "hardVetoIds": ["preserve_projected_xy", "no_runtime_proof_without_evidence"],
    },
]

SOURCE_HASH_PATHS = [
    "AGENTS.md",
    "package.json",
    ".codex/hooks.json",
    ".codex/config.toml",
    ".codex/hooks/cplayout_pre_tool_use.py",
    ".codex/hooks/cplayout_stop_multi_agent.py",
    ".codex/hooks/cplayout_prompt_triage.py",
    ".codex/hooks/cplayout_subagent_start.py",
    ".codex/hooks/cplayout_route_data.json",
    "tools/build_cplayout_context_map.py",
    "tools/validate_cplayout_skills.py",
    "docs/agent-prompt-registry.md",
    "docs/README.md",
    "docs/agent-known-gaps.md",
    "docs/agent-source-ledger.md",
    "docs/codex-managed-hook-deployment.md",
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_route_data() -> dict[str, Any]:
    return json.loads(ROUTE_DATA_PATH.read_text(encoding="utf-8"))


def _load_agents() -> dict[str, str]:
    agents: dict[str, str] = {}
    for path in sorted((ROOT / ".codex" / "agents").glob("*.toml")):
        parsed = tomllib.loads(path.read_text(encoding="utf-8"))
        name = parsed.get("name")
        if isinstance(name, str) and name.strip():
            agents[name] = path.relative_to(ROOT).as_posix()
    return agents


def _skill_paths() -> dict[str, str]:
    skills: dict[str, str] = {}
    for path in sorted((ROOT / ".agents" / "skills").glob("*/SKILL.md")):
        skills[path.parent.name] = path.relative_to(ROOT).as_posix()
    return skills


def _source_hashes() -> dict[str, str]:
    paths = list(SOURCE_HASH_PATHS)
    paths.extend(_load_agents().values())
    paths.extend(_skill_paths().values())
    paths.extend(path.relative_to(ROOT).as_posix() for path in (ROOT / ".agents" / "skills").glob("*/references/*") if path.is_file())
    hashes: dict[str, str] = {}
    for relpath in sorted(set(paths)):
        path = ROOT / relpath
        if path.exists():
            hashes[relpath] = _sha256(path)
    return hashes


def _expand_ids(values: list[str], all_values: list[str]) -> list[str]:
    if values == ["*"]:
        return list(all_values)
    return list(values)


def _build_context_map() -> dict[str, Any]:
    route_data = _load_route_data()
    routes = route_data.get("routes")
    if not isinstance(routes, list):
        raise ValueError("route data routes must be a list")
    route_ids = [route["id"] for route in routes if isinstance(route, dict) and isinstance(route.get("id"), str)]
    agents = _load_agents()
    agent_ids = sorted(agents)

    context_packs: list[dict[str, Any]] = []
    route_context = {route_id: [] for route_id in route_ids}
    agent_context = {agent_id: [] for agent_id in agent_ids}

    for raw_pack in PACK_DEFINITIONS:
        pack = dict(raw_pack)
        pack["routeIds"] = _expand_ids(pack["routeIds"], route_ids)
        pack["agentIds"] = _expand_ids(pack["agentIds"], agent_ids)
        context_packs.append(pack)
        for route_id in pack["routeIds"]:
            route_context.setdefault(route_id, []).append(pack["id"])
        for agent_id in pack["agentIds"]:
            agent_context.setdefault(agent_id, []).append(pack["id"])

    data = {
        "schemaVersion": 1,
        "generatedBy": "tools/build_cplayout_context_map.py",
        "limits": LIMITS,
        "globalContext": GLOBAL_CONTEXT,
        "contextPacks": context_packs,
        "routeContext": route_context,
        "agentContext": agent_context,
        "validationCommands": VALIDATION_COMMANDS,
        "panelProfiles": {
            "xhigh_governance": {
                "appliesToRoutes": ["cplayout_kb_curator"],
                "maxSpecialists": 3,
                "subagentReasoning": "task_selected",
                "weights": [
                    {"role": "kb_context", "weight": 0.30},
                    {"role": "hook_routing_tooling", "weight": 0.25},
                    {"role": "validation_qa", "weight": 0.20},
                    {"role": "matched_domain_specialist", "weight": 0.15},
                    {"role": "offline_security_constraints", "weight": 0.10},
                ],
                "hardVetoIds": [
                    "no_paid_or_keyed_services",
                    "no_runtime_proof_without_evidence",
                    "hooks_are_advisory",
                    "stop_hook_disabled",
                ],
            }
        },
        "hardVetoes": HARD_VETOES,
        "sourceHashes": _source_hashes(),
    }
    _validate_context_map(data)
    return data


def _require_relpath(relpath: str) -> None:
    if relpath.startswith("/") or relpath.startswith("~") or "\\" in relpath:
        raise ValueError(f"{relpath}: paths must be relative repo paths with forward slashes")
    if relpath.startswith("reports/") or relpath.startswith("tmp/"):
        raise ValueError(f"{relpath}: raw report/tmp paths are not allowed in context packs")
    generated_outputs = {
        CONTEXT_DOC_PATH.relative_to(ROOT).as_posix(),
        GOVERNANCE_SUMMARY_PATH.relative_to(ROOT).as_posix(),
    }
    if relpath in generated_outputs:
        return
    if not (ROOT / relpath).exists():
        raise ValueError(f"{relpath}: referenced path does not exist")


def _validate_context_map(data: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1:
        raise ValueError("schemaVersion must be 1")

    route_data = _load_route_data()
    routes = route_data.get("routes", [])
    route_ids = {route.get("id") for route in routes if isinstance(route, dict)}
    agent_ids = set(_load_agents())
    validation_ids = set(data.get("validationCommands", {}))
    hard_veto_ids = {veto.get("id") for veto in data.get("hardVetoes", []) if isinstance(veto, dict)}
    limits = data.get("limits", {})

    pack_ids: list[str] = []
    for pack in data.get("contextPacks", []):
        if not isinstance(pack, dict):
            raise ValueError("contextPacks entries must be objects")
        pack_id = pack.get("id")
        if not isinstance(pack_id, str) or not pack_id:
            raise ValueError("context pack id must be a non-empty string")
        pack_ids.append(pack_id)
        if not isinstance(pack.get("purpose"), str) or not pack["purpose"].strip():
            raise ValueError(f"{pack_id}: purpose is required")
        read_first = pack.get("readFirstPaths")
        secondary = pack.get("secondaryPaths")
        command_ids = pack.get("validationCommandIds")
        for field_name, values, max_key in (
            ("readFirstPaths", read_first, "maxReadFirstPathsPerPack"),
            ("secondaryPaths", secondary, "maxSecondaryPathsPerPack"),
        ):
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                raise ValueError(f"{pack_id}: {field_name} must be a string list")
            if len(values) > int(limits[max_key]):
                raise ValueError(f"{pack_id}: {field_name} exceeds {max_key}")
            for relpath in values:
                _require_relpath(relpath)
        if not isinstance(command_ids, list) or not all(isinstance(value, str) for value in command_ids):
            raise ValueError(f"{pack_id}: validationCommandIds must be a string list")
        if len(command_ids) > int(limits["maxValidationCommandsPerPack"]):
            raise ValueError(f"{pack_id}: validationCommandIds exceeds maxValidationCommandsPerPack")
        for command_id in command_ids:
            if command_id not in validation_ids:
                raise ValueError(f"{pack_id}: unknown validation command {command_id}")
        for route_id in pack.get("routeIds", []):
            if route_id not in route_ids:
                raise ValueError(f"{pack_id}: unknown route id {route_id}")
        for agent_id in pack.get("agentIds", []):
            if agent_id not in agent_ids:
                raise ValueError(f"{pack_id}: unknown agent id {agent_id}")
        for veto_id in pack.get("hardVetoIds", []):
            if veto_id not in hard_veto_ids:
                raise ValueError(f"{pack_id}: unknown hard veto {veto_id}")
        token_budget = pack.get("tokenBudget")
        if not isinstance(token_budget, int) or token_budget <= 0:
            raise ValueError(f"{pack_id}: tokenBudget must be a positive integer")
        max_pack_budget = int(limits["maxContextPackTokenBudget"])
        if token_budget > max_pack_budget:
            raise ValueError(f"{pack_id}: tokenBudget exceeds maxContextPackTokenBudget")

    duplicates = sorted({pack_id for pack_id in pack_ids if pack_ids.count(pack_id) > 1})
    if duplicates:
        raise ValueError(f"duplicate context pack ids: {', '.join(duplicates)}")

    known_pack_ids = set(pack_ids)
    for route_id in route_ids:
        pack_refs = data.get("routeContext", {}).get(route_id)
        if not isinstance(pack_refs, list) or not pack_refs:
            raise ValueError(f"routeContext missing {route_id}")
        for pack_ref in pack_refs:
            if pack_ref not in known_pack_ids:
                raise ValueError(f"routeContext {route_id} references unknown pack {pack_ref}")
    for agent_id in agent_ids:
        pack_refs = data.get("agentContext", {}).get(agent_id)
        if not isinstance(pack_refs, list) or not pack_refs:
            raise ValueError(f"agentContext missing {agent_id}")
        for pack_ref in pack_refs:
            if pack_ref not in known_pack_ids:
                raise ValueError(f"agentContext {agent_id} references unknown pack {pack_ref}")

    for profile_name, profile in data.get("panelProfiles", {}).items():
        weights = profile.get("weights") if isinstance(profile, dict) else None
        if not isinstance(weights, list) or not weights:
            raise ValueError(f"{profile_name}: weights must be a non-empty list")
        total = 0.0
        roles: set[str] = set()
        for entry in weights:
            if not isinstance(entry, dict) or type(entry.get("weight")) not in (int, float):
                raise ValueError(f"{profile_name}: weight entries must include numeric weight")
            weight = float(entry["weight"])
            if not math.isfinite(weight) or weight < 0:
                raise ValueError(f"{profile_name}: weights must be finite and nonnegative")
            role = entry.get("role")
            if not isinstance(role, str) or not role.strip() or role in roles:
                raise ValueError(f"{profile_name}: roles must be nonempty and unique")
            roles.add(role)
            total += weight
        if abs(total - 1.0) > 0.0001:
            raise ValueError(f"{profile_name}: weights must sum to 1.0")


def _json_text(data: dict[str, Any]) -> str:
    return json.dumps(data, indent=2, sort_keys=True) + "\n"


def _markdown_text(data: dict[str, Any]) -> str:
    lines = [
        "# CPLayout Agent Context Map",
        "",
        "Generated by `tools/build_cplayout_context_map.py`. Edit the generator, then run `npm run context-map:build`.",
        "",
        "This record provides compact route-to-context references for hooks, coordinators, and subagents. It is advisory only and does not prove hook enforcement, subagent execution, product runtime behavior, or visual/native proof.",
        "",
        "## Limits",
        "",
    ]
    for key, value in data["limits"].items():
        lines.append(f"- `{key}`: `{value}`")

    lines.extend(
        [
            "",
            "## Context Packs",
            "",
            "| Pack | Token Budget | Purpose | Minimum Read | Secondary Read | Validation |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    validation_commands = data["validationCommands"]
    for pack in data["contextPacks"]:
        read_first = "<br>".join(f"`{path}`" for path in pack["readFirstPaths"])
        secondary = "<br>".join(f"`{path}`" for path in pack["secondaryPaths"])
        commands = "<br>".join(f"`{validation_commands[command_id]['command']}`" for command_id in pack["validationCommandIds"])
        lines.append(
            f"| `{pack['id']}` | `{pack['tokenBudget']}` | {pack['purpose']} | {read_first} | {secondary} | {commands} |"
        )

    lines.extend(["", "## Route Context", "", "| Route | Context Packs |", "| --- | --- |"])
    for route_id, pack_ids in sorted(data["routeContext"].items()):
        lines.append(f"| `{route_id}` | {', '.join(f'`{pack_id}`' for pack_id in pack_ids)} |")

    pack_by_id = {pack["id"]: pack for pack in data["contextPacks"]}
    lines.extend(
        [
            "",
            "## Route Read Guidance",
            "",
            "Use minimum-read entries before mutation. Use secondary-read entries only when the minimum set leaves a task-specific gap.",
            "",
            "| Route | Minimum Read | Secondary Read |",
            "| --- | --- | --- |",
        ]
    )
    for route_id, pack_ids in sorted(data["routeContext"].items()):
        minimum: list[str] = []
        secondary_paths: list[str] = []
        for pack_id in pack_ids:
            pack = pack_by_id[pack_id]
            for path in pack["readFirstPaths"]:
                if path not in minimum:
                    minimum.append(path)
            for path in pack["secondaryPaths"]:
                if path not in secondary_paths and path not in minimum:
                    secondary_paths.append(path)
        min_text = "<br>".join(f"`{path}`" for path in minimum[:8])
        secondary_text = "<br>".join(f"`{path}`" for path in secondary_paths[:8])
        lines.append(f"| `{route_id}` | {min_text} | {secondary_text} |")

    lines.extend(["", "## Agent Context", "", "| Agent | Context Packs |", "| --- | --- |"])
    for agent_id, pack_ids in sorted(data["agentContext"].items()):
        lines.append(f"| `{agent_id}` | {', '.join(f'`{pack_id}`' for pack_id in pack_ids)} |")

    lines.extend(["", "## Hard Vetoes", ""])
    for veto in data["hardVetoes"]:
        lines.append(f"- `{veto['id']}`: {veto['summary']}")

    lines.extend(["", "## Source Hashes", ""])
    for relpath, digest in sorted(data["sourceHashes"].items()):
        lines.append(f"- `{relpath}`: `{digest}`")
    lines.append("")
    return "\n".join(lines)


def _governance_summary_text(data: dict[str, Any]) -> str:
    validation_commands = data["validationCommands"]
    lines = [
        "# CPLayout Agent Governance Summary",
        "",
        "Generated by `tools/build_cplayout_context_map.py`. Edit the generator, then run `npm run context-map:build`.",
        "",
        "This is the compact first-read entrypoint for agent governance. It is advisory documentation, not product runtime proof or hook enforcement.",
        "",
        "## Active Contracts",
        "",
        "- Start non-trivial work with `AGENTS.md`, `git status --short`, task complexity, selected reasoning effort, subagent decision, and validation gates.",
        "- Preserve offline/no-cost operation, projected/local `XY` canonical geometry, and visual-only KML/KMZ style metadata.",
        "- Treat repo-local hooks and context maps as advisory until managed deployment, restart, `/hooks`, and live prompt evidence are verified.",
        "- Spawn bounded subagents for non-trivial CPLayout work when available; otherwise record `Accepted fallback:` with the reason.",
        "- Do not claim native, SQLite, ZIP, MapLibre, Google Earth, imagery, or ML/CV runtime proof without direct checklist evidence.",
        "",
        "## Matched Records",
        "",
        "- Prompt routing and subagent authorization: `docs/agent-prompt-registry.md`.",
        "- Detailed context packs and source hashes: `docs/agent-context-map.md` and `.codex/hooks/cplayout_context_map.json`.",
        "- Source/freshness ledger: `docs/agent-source-ledger.md`.",
        "- Section-addressable gaps: `docs/agent-known-gaps.md`.",
        "- Managed hook deployment caveats: `docs/codex-managed-hook-deployment.md`.",
        "",
        "## Stale-Proof Caveats",
        "",
        "- Codex, package, platform, and managed-hook claims require dated source-ledger rows and may need refresh before architecture changes.",
        "- Google Earth proof is artifact-specific; future claims need non-black rendered evidence, overlay confirmation, hashes, and uncontaminated cleanup.",
        "- Android SQLite/ZIP and native MapLibre reports do not prove iOS, raw PMTiles/MBTiles, imported raster packages, or broad native parity.",
        "- Companion imagery/ML/CV packets are evidence-only until a separate projected-XY reducer workflow is implemented and proved.",
        "",
        "## Validation Gates",
        "",
    ]
    for command_id in ("context_map_check", "validate_skills", "validate_product", "diff_check", "audit"):
        command = validation_commands[command_id]
        lines.append(f"- `{command['command']}`: {command['purpose']}")
    lines.extend(["", "## Token Budgets", ""])
    for key, value in data["limits"].items():
        lines.append(f"- `{key}`: `{value}`")
    lines.extend(["", "## Hard Vetoes", ""])
    for veto in data["hardVetoes"]:
        lines.append(f"- `{veto['id']}`: {veto['summary']}")
    lines.append("")
    text = "\n".join(lines)
    if len(text) > int(data["limits"]["maxGovernanceSummaryChars"]):
        raise ValueError("governance summary exceeds maxGovernanceSummaryChars")
    return text


def _write_if_changed(path: Path, text: str) -> bool:
    current = path.read_text(encoding="utf-8") if path.exists() else None
    if current == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="Write generated JSON and Markdown files.")
    mode.add_argument("--check", action="store_true", help="Fail if generated files are missing or stale.")
    args = parser.parse_args(argv)

    data = _build_context_map()
    json_text = _json_text(data)
    markdown_text = _markdown_text(data)
    governance_summary_text = _governance_summary_text(data)

    if args.write:
        changed = [
            relpath
            for relpath, did_change in (
                (CONTEXT_MAP_PATH.relative_to(ROOT), _write_if_changed(CONTEXT_MAP_PATH, json_text)),
                (CONTEXT_DOC_PATH.relative_to(ROOT), _write_if_changed(CONTEXT_DOC_PATH, markdown_text)),
                (
                    GOVERNANCE_SUMMARY_PATH.relative_to(ROOT),
                    _write_if_changed(GOVERNANCE_SUMMARY_PATH, governance_summary_text),
                ),
            )
            if did_change
        ]
        if changed:
            print("Updated:")
            for relpath in changed:
                print(f"- {relpath}")
        else:
            print("Context map is already up to date.")
        return 0

    stale: list[str] = []
    if not CONTEXT_MAP_PATH.exists() or CONTEXT_MAP_PATH.read_text(encoding="utf-8") != json_text:
        stale.append(str(CONTEXT_MAP_PATH.relative_to(ROOT)))
    if not CONTEXT_DOC_PATH.exists() or CONTEXT_DOC_PATH.read_text(encoding="utf-8") != markdown_text:
        stale.append(str(CONTEXT_DOC_PATH.relative_to(ROOT)))
    if not GOVERNANCE_SUMMARY_PATH.exists() or GOVERNANCE_SUMMARY_PATH.read_text(encoding="utf-8") != governance_summary_text:
        stale.append(str(GOVERNANCE_SUMMARY_PATH.relative_to(ROOT)))
    if stale:
        print("Context map is stale. Run npm run context-map:build.", file=sys.stderr)
        for relpath in stale:
            print(f"- {relpath}", file=sys.stderr)
        return 1
    print("Context map is up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
