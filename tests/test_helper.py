import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("helper", ROOT / "helper" / "openrac_graphics_helper.py")
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class HelperTests(unittest.TestCase):
    def test_job_validation(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "job.json"
            path.write_text(json.dumps({"format":1,"kind":helper.JOB_KIND,"operation":"ai.textures","game":"rac1","version":"pal"}))
            self.assertEqual(helper.read_job(path)["operation"], "ai.textures")
            path.write_text("{}")
            with self.assertRaises(ValueError):
                helper.read_job(path)

    def test_levels_are_discovered_by_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name in ["level_02", "level_00", "notes"]:
                (root / name).mkdir()
            (root / "level_02" / "manifest.json").write_text("{}")
            (root / "level_00" / "manifest.json").write_text("{}")
            self.assertEqual(helper.level_numbers(root), [0, 2])

    def test_zip_is_deterministic(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pack = root / "pack"
            pack.mkdir()
            (pack / "openrac-mod.json").write_text("{}")
            (pack / "a.txt").write_text("x")
            a, b = root / "a.zip", root / "b.zip"
            helper.zip_pack(pack, a)
            helper.zip_pack(pack, b)
            self.assertEqual(a.read_bytes(), b.read_bytes())


if __name__ == "__main__":
    unittest.main()
