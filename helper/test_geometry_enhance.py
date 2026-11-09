from __future__ import annotations

import json
import math
from pathlib import Path
import tempfile
import unittest

from helper.geometry_enhance import (
    _append_accessor,
    enhance_gltf,
    geometry_profile,
    read_accessor,
    select_adaptive_edges,
    split_crease_vertices,
)


def write_fixture(root: Path, kind: str = "moby") -> Path:
    if kind == "terrain":
        folder = root / "terrain"
    elif kind == "tie":
        folder = root / "ties" / "tie_5"
    elif kind == "shrub":
        folder = root / "shrubs" / "shrub_6"
    else:
        folder = root / "mobys" / "moby_7_test"
    folder.mkdir(parents=True)
    path = folder / "model.gltf"
    blob = bytearray()
    doc = {
        "asset": {"version": "2.0"},
        "buffers": [{"uri": "model.bin", "byteLength": 0}],
        "bufferViews": [],
        "accessors": [],
        "meshes": [{"primitives": []}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    positions = [(0.0,0.0,0.0),(2.0,0.0,0.0),(0.0,2.0,0.0)]
    normals = [(0.0,0.0,1.0)] * 3
    tangents = [(1.0,0.0,0.0,1.0)] * 3
    uvs = [(0.0,0.0),(1.0,0.0),(0.0,1.0)]
    colours = [(1.0,0.5,0.25,1.0),(0.5,1.0,0.25,1.0),(0.25,0.5,1.0,1.0)]
    joints = [(0,1,0,0),(0,1,0,0),(0,1,0,0)]
    weights = [(0.75,0.25,0.0,0.0),(0.5,0.5,0.0,0.0),(0.25,0.75,0.0,0.0)]

    attrs = {
        "POSITION": _append_accessor(doc,blob,positions,component=5126,type_name="VEC3",target=34962,include_bounds=True),
        "NORMAL": _append_accessor(doc,blob,normals,component=5126,type_name="VEC3",target=34962),
        "TANGENT": _append_accessor(doc,blob,tangents,component=5126,type_name="VEC4",target=34962),
        "TEXCOORD_0": _append_accessor(doc,blob,uvs,component=5126,type_name="VEC2",target=34962),
        "COLOR_0": _append_accessor(doc,blob,colours,component=5126,type_name="VEC4",target=34962),
        "JOINTS_0": _append_accessor(doc,blob,joints,component=5123,type_name="VEC4",target=34962),
        "WEIGHTS_0": _append_accessor(doc,blob,weights,component=5126,type_name="VEC4",target=34962),
    }
    indices = _append_accessor(doc,blob,[(0,),(1,),(2,)],component=5125,type_name="SCALAR",target=34963)
    doc["meshes"][0]["primitives"].append({"attributes": attrs, "indices": indices, "mode": 4})
    doc["buffers"][0]["byteLength"] = len(blob)
    (folder / "model.bin").write_bytes(blob)
    path.write_text(json.dumps(doc,indent=2)+"\n",encoding="utf-8")
    return path


class GeometryEnhanceTests(unittest.TestCase):
    def test_high_subdivision_preserves_uv_skinning_and_tangent_space(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_fixture(Path(tmp),"moby")
            report = enhance_gltf(path,mode="high")
            self.assertTrue(report["changed"])
            primitive = report["primitives"][0]
            self.assertEqual(primitive["triangles_before"],1)
            self.assertEqual(primitive["triangles_after"],4)
            self.assertEqual(primitive["vertices_before"],3)
            self.assertEqual(primitive["vertices_after"],6)
            self.assertFalse(primitive["collision_rebuild_recommended"])

            doc=json.loads(path.read_text(encoding="utf-8"))
            blob=(path.parent/"model.bin").read_bytes()
            p=doc["meshes"][0]["primitives"][0]
            uvs=read_accessor(doc,blob,p["attributes"]["TEXCOORD_0"])
            joints=read_accessor(doc,blob,p["attributes"]["JOINTS_0"])
            weights=read_accessor(doc,blob,p["attributes"]["WEIGHTS_0"])
            normals=read_accessor(doc,blob,p["attributes"]["NORMAL"])
            tangents=read_accessor(doc,blob,p["attributes"]["TANGENT"])
            indices=read_accessor(doc,blob,p["indices"])
            self.assertEqual(len(uvs),6)
            self.assertEqual(len(indices),12)
            self.assertEqual(len(joints),len(weights))
            for row in weights:
                self.assertAlmostEqual(sum(row),1.0,places=5)
            for row in normals:
                self.assertAlmostEqual(math.sqrt(sum(v*v for v in row)),1.0,places=5)
            for row in tangents:
                self.assertAlmostEqual(math.sqrt(sum(v*v for v in row[:3])),1.0,places=5)
                self.assertIn(round(row[3]),(-1,1))

    def test_ultra_can_add_two_crack_free_subdivision_levels_when_budget_allows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"terrain")
            report=enhance_gltf(path,mode="ultra",options={"triangle_budget":1000})
            p=report["primitives"][0]
            self.assertEqual(p["subdivisions_applied"],2)
            self.assertEqual(p["triangles_after"],16)
            self.assertEqual(p["vertices_after"],15)
            self.assertFalse(p["budget_limited"])

    def test_budget_stops_excessive_subdivision(self):
        profile=geometry_profile("ultra","moby",{"triangle_budget":256})
        self.assertEqual(profile.triangle_budget,256)
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"moby")
            # Inflate the request via a fixture with one triangle; it still fits two passes.
            report=enhance_gltf(path,mode="ultra",options={"triangle_budget":4})
            # Profile clamps pathological budgets to a safe minimum instead of accepting zero/tiny values.
            self.assertGreaterEqual(report["profile"]["triangle_budget"],256)

    def test_shape_refine_is_opt_in_and_protected_for_gameplay_meshes(self):
        safe=geometry_profile("ultra","moby",{"shape_refine":True})
        risky=geometry_profile("experimental","moby",{
            "shape_refine":True,
            "allow_collision_mismatch":True,
        })
        static=geometry_profile("ultra","tie",{"shape_refine":True})
        self.assertEqual(safe.shape_relax,0.0)
        self.assertGreater(risky.shape_relax,0.0)
        self.assertGreater(static.shape_relax,0.0)

    def test_modern_profile_uses_larger_adaptive_budget_without_collision_movement(self):
        profile=geometry_profile("modern","moby",{"shape_refine":True})
        self.assertEqual(profile.subdivisions,2)
        self.assertEqual(profile.triangle_budget,120_000)
        self.assertTrue(profile.adaptive_subdivision)
        self.assertEqual(profile.shape_relax,0.0)
        self.assertAlmostEqual(profile.crease_angle_degrees,50.0)

    def test_adaptive_selection_spends_budget_on_long_or_curved_edges(self):
        positions=[
            (0.0,0.0,0.0),(4.0,0.0,0.0),(0.0,4.0,0.0),
            (0.2,0.2,0.0),
        ]
        indices=[0,1,2, 0,3,1]
        selected=select_adaptive_edges(
            positions,indices,triangle_budget=5,mode="modern",pass_index=0
        )
        self.assertTrue(selected)
        # Each selected edge has a globally consistent key, preventing T-junction cracks.
        self.assertTrue(all(a < b for a,b in selected))
        self.assertLessEqual(len(indices)//3 + sum(
            2 if edge == (0,1) else 1 for edge in selected
        ),5)

    def test_crease_preservation_splits_shared_vertex_across_a_hard_fold(self):
        attrs={
            "POSITION":[
                (0.0,0.0,0.0),(1.0,0.0,0.0),(0.0,1.0,0.0),(0.0,0.0,1.0),
            ],
            "TEXCOORD_0":[
                (0.0,0.0),(1.0,0.0),(0.0,1.0),(1.0,1.0),
            ],
        }
        # Two triangles meet at roughly 90 degrees and share vertices 0 and 1.
        out,new_indices,splits=split_crease_vertices(attrs,[0,1,2, 0,3,1],55.0)
        self.assertGreaterEqual(splits,2)
        self.assertGreater(len(out["POSITION"]),len(attrs["POSITION"]))
        self.assertNotEqual(new_indices[0],new_indices[3])
        self.assertNotEqual(new_indices[1],new_indices[5])

    def test_unsupported_morph_target_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"moby")
            doc=json.loads(path.read_text(encoding="utf-8"))
            doc["meshes"][0]["primitives"][0]["targets"]=[{"POSITION":doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]}]
            path.write_text(json.dumps(doc),encoding="utf-8")
            report=enhance_gltf(path,mode="high")
            self.assertFalse(report["changed"])
            self.assertIn("morph targets",report["primitives"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
