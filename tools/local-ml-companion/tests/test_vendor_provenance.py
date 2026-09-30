"""Verify the admitted wheel bytes without an installed sibling checkout."""
import hashlib
import json
from pathlib import Path
import unittest
import zipfile


class VendorProvenanceTests(unittest.TestCase):
    def test_wheel_manifest_notice_and_dependency_pin_agree(self):
        root = Path(__file__).resolve().parents[1]
        vendor = root / "vendor"
        record = json.loads((vendor / "provenance.json").read_text())
        wheel = vendor / record["wheel"]
        self.assertEqual(hashlib.sha256(wheel.read_bytes()).hexdigest(), record["sha256"])
        with zipfile.ZipFile(wheel) as archive:
            manifest_name = next(n for n in archive.namelist() if n.endswith("/source-manifest.json"))
            raw = archive.read(manifest_name)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), record["source_manifest_sha256"])
            manifest = json.loads(raw)
            self.assertEqual(len(manifest["files"]), record["verified_source_files"])
            for entry in manifest["files"]:
                data = archive.read(entry["path"])
                self.assertEqual(len(data), entry["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
            notice = archive.read(manifest["notice"]["path"])
            self.assertEqual(notice, (vendor / "NOTICE.txt").read_bytes())
            self.assertEqual(hashlib.sha256(notice).hexdigest(), record["notice_sha256"])
        self.assertIn(record["wheel"], (root / "pyproject.toml").read_text())
        self.assertIn(record["sha256"], (root / "uv.lock").read_text())
